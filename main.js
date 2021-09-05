const ethers = require('ethers');
const ABI = require('./ABI');
const bigRational = require("big-rational");
const { RateLimiter } = require("limiter");
const EventEmitter = require('events');

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = (query) => new Promise((resolve) => rl.question(query, resolve));
process.title = "Euler's Hertz Feed"

const SWAP_TYPE = {BUY: "BUY", SELL: "SELL"};
const SWAP_EVENT = "SWAP_EVENT";

const database = {endpoints: { }};

async function init(){
    console.log("*** Euler's very simple htz feed ****\n");
    console.log("I require an endpoint through which I can access the fantom blockchain. You can get one for free through ankr:");
    let tutorial = '    * Sign up at https://app.ankr.com/auth/sign-up\n'
    tutorial += '    * Select the API tab on the left and click to create a new project\n'
    tutorial += '    * Select the fantom network and click create\n'
    tutorial += '    * Switch to using "token" for authentication, and click create again\n'
    tutorial += '    * Click on your new project, click on settings, and copy the endpoint that begins with https'
    console.log(tutorial);
    console.log("Or just press ENTER when prompted and I will use Euler's (it will start complaining with too many of us using it though though because it's a free account too!)\n");

    let endpoint = await prompt("\nPaste your endpoint here (you may have to right click the toolbar -> edit -> paste instead of ctrl-V):");
    console.log("Thank you :)\n\nInitialising hertz feed (this may take about 30 seconds)...");
    if (!endpoint){
        endpoint = "https://apis.ankr.com/9acd7b67547a4c02b7e0093b9fc509ce/4b7b909b5596505a954a45acc3173c92/fantom/full/main";
    }
    
    console.log('- Adding endpoint');
    addEndpoint(endpoint)
    console.log('- Creating fiat tracker');
    let customFiatTracker
    while (!customFiatTracker){
        try {
            customFiatTracker = await createSimpleFiatTracker(
                endpoint,
                '0x152eE697f2E276fA89E96742e9bB9aB1F2E61bE3',//spooky factory
                '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75',//usdc
                '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'//ftm
            )
        } catch {
            console.log("Hmm. That didn't work- let me try again...");
        }
    }
    
    let xdaoHtzFtmPairEntry = await addToken({
        endpoint: endpoint,
        factoryAddress: '0xcb9ea67a5eb76d22688bf21d6689c435d4e25077',
        tokenAddress: '0x68F7880F7af43a81bEf25E2aE83802Eb6c2DdBFD',//hertz
        comparatorAddress: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83',//ftm
        fiatAddress: undefined,
        customFiatTracker
        //we can sneakily set up a tracker to convert ftm to usdc, because xdao doesn't have that yet
        
    })

    console.log(`Current Price: ${xdaoHtzFtmPairEntry.initialComparatorAmountPerTokenRational.toDecimal(8)} ${xdaoHtzFtmPairEntry.comparatorSymbol} ($${ xdaoHtzFtmPairEntry.initialFiatAmountPerTokenRational.toDecimal(8)})`);
    console.log("OK. Listening for trades...\n");

    xdaoHtzFtmPairEntry.emitter.on(SWAP_EVENT, async (pairEntry, swapInfo) => {
        let outputString = `Transaction: https://ftmscan.com/tx/${swapInfo.transactionHash}\n${swapInfo.action}: `;
        outputString += `${swapInfo.tokenAmountRational.toDecimal(8)} ${pairEntry.tokenSymbol} for `
        outputString +=  `${swapInfo.comparatorAmountRational.toDecimal(8)} ${pairEntry.comparatorSymbol} `
        outputString += `($${swapInfo.fiatAmountRational.toDecimal(8)})\n`;
        outputString += `Current Price: ${swapInfo.tokenPriceInComparator.toDecimal(8)} ${pairEntry.comparatorSymbol} ($${swapInfo.tokenPriceInFiat.toDecimal(8)})\n`;
        console.log(outputString);
    });

}
(() => {init();})();







function addEndpoint(endpoint){
    //provider
    if (!database.endpoints[endpoint]){
        const limiter =  new RateLimiter({ tokensPerInterval: 2, interval: "second" });
        database.endpoints[endpoint] = {
            provider:  new ethers.providers.JsonRpcProvider(endpoint),
            eventFilter: {
                address: [],
                topics: [ethers.utils.id("Swap(address,uint256,uint256,uint256,uint256,address)")]
            },
            limiter: limiter,
            sendOne:  async function sendOne(obj, functionName, ...args){
                const remainingRequests = await limiter.removeTokens(1);
                return obj[functionName](...args);
            },
            factoryAddresses: { }
        }
    }
}



async function addToken({
    endpoint,
    factoryAddress,
    tokenAddress,
    comparatorAddress,
    //provide either fiatAddress or customFiatTracker for first token of comparator, otherwise 
    //it's optional- if provided will replace old one, if not we will use the one provided before.
    fiatAddress,
    customFiatTracker
}) {    
        //provider
        if (!database.endpoints[endpoint]){
            addEndpoint(endpoint);
        }
        const provider =  database.endpoints[endpoint].provider;
        const sendOne = database.endpoints[endpoint].sendOne;

        //factory
        if (!database.endpoints[endpoint].factoryAddresses[factoryAddress]){
            database.endpoints[endpoint].factoryAddresses[factoryAddress] = {
                factoryContract: ABI.createFactoryContract(provider, factoryAddress),
                comparatorAddresses: {}
            }
        }
        const factoryEntry =  database.endpoints[endpoint].factoryAddresses[factoryAddress];
        const factoryContract =  factoryEntry.factoryContract;
        
        //comparator
        if (!factoryEntry.comparatorAddresses[comparatorAddress]){
            factoryEntry.comparatorAddresses[comparatorAddress] = {
                fiatTokenTracker: undefined,
                pairAddresses: {}
            }
        }
        const comparatorEntry = factoryEntry.comparatorAddresses[comparatorAddress];
        if (customFiatTracker){
            if (factoryEntry.comparatorAddresses[comparatorAddress].fiatTokenTracker){
                factoryEntry.comparatorAddresses[comparatorAddress].fiatTokenTracker.stopListening();
            }
            factoryEntry.comparatorAddresses[comparatorAddress].fiatTokenTracker = customFiatTracker;
        }
        if (!factoryEntry.comparatorAddresses[comparatorAddress].fiatTokenTracker){
            if (!fiatAddress){
                console.log('todo handle no fiatAddress given when necessary');
                return;
            }
            factoryEntry.comparatorAddresses[comparatorAddress].fiatTokenTracker = await createSimpleFiatTracker(
                endpoint, factoryAddress, fiatAddress, comparatorAddress
            )
        }

        //pair
        console.log('- Discovering pair address');
        const pairAddress = await sendOne(factoryContract, 'getPair', tokenAddress, comparatorAddress);
        if (comparatorEntry.pairAddresses[pairAddress]){
            console.log('todo handle pair already exists');
            return;
        }

        comparatorEntry.pairAddresses[pairAddress] = {
            emitter: new EventEmitter(),
            pairAddress: pairAddress,
            pairContract:  ABI.createPairContract(database.endpoints[endpoint].provider, pairAddress),
            tokenContract: ABI.createTokenContract(database.endpoints[endpoint].provider, tokenAddress),
            comparatorContract: ABI.createTokenContract(database.endpoints[endpoint].provider, comparatorAddress),
            initialComparatorAmountPerTokenRational: undefined, 
            initialFiatAmountPerTokenRational: undefined,
            swapHistory: [],

            token0Address: undefined,
            token1Address: undefined,
            isTokenToken0: undefined,
            
            tokenDecimals: undefined,
            tokenSymbol: undefined,
            comparatorDecimals: undefined,
            comparatorSymbol: undefined,

            token0Decimals: undefined,
            token0Symbol: undefined,
            token1Decimals: undefined,
            token1Symbol: undefined,
        }
        const pairEntry = comparatorEntry.pairAddresses[pairAddress];
        
        console.log('- Discovering token details');
        const [token0Address, token1Address] = await Promise.all([
            sendOne(pairEntry.pairContract, 'token0'),
            sendOne(pairEntry.pairContract, 'token1'),
        ]);
        pairEntry.token0Address = token0Address;
        pairEntry.token1Address = token1Address;
        pairEntry.isTokenToken0 = tokenAddress === token0Address;

        const [tokenDecimals, tokenSymbol, comparatorDecimals, comparatorSymbol] = await Promise.all([
            sendOne(pairEntry.tokenContract, 'decimals'),
            sendOne(pairEntry.tokenContract, 'symbol'),
            sendOne(pairEntry.comparatorContract, 'decimals'),
            sendOne(pairEntry.comparatorContract, 'symbol'),
        ]);
        pairEntry.tokenDecimals = tokenDecimals;
        pairEntry.tokenSymbol = tokenSymbol;
        pairEntry.comparatorDecimals = comparatorDecimals;
        pairEntry.comparatorSymbol = comparatorSymbol;

        pairEntry.token0Decimals = pairEntry.isTokenToken0 ? tokenDecimals : comparatorDecimals;
        pairEntry.token0Symbol = pairEntry.isTokenToken0 ? tokenSymbol : comparatorSymbol;
        pairEntry.token1Decimals = pairEntry.isTokenToken0 ? comparatorDecimals : tokenDecimals;
        pairEntry.token1Symbol = pairEntry.isTokenToken0 ? comparatorSymbol : tokenSymbol;

        provider.off(database.endpoints[endpoint].eventFilter);

        database.endpoints[endpoint].eventFilter.address.push(pairAddress);

        const currentTokenPriceInComparator = await getCurrentPrice(
            pairEntry.pairContract, pairEntry.token0Decimals, pairEntry.token1Decimals, pairEntry.isTokenToken0, sendOne
        )
        const comparatorFiatPriceInfo = factoryEntry.comparatorAddresses[comparatorAddress].fiatTokenTracker.getLastPriceInfo();
        const currentFiatPrice = currentTokenPriceInComparator.multiply(comparatorFiatPriceInfo.fiatPerToken);
        pairEntry.initialComparatorAmountPerTokenRational = currentTokenPriceInComparator;
        pairEntry.initialFiatAmountPerTokenRational = currentFiatPrice;     

        provider.on(database.endpoints[endpoint].eventFilter, logHandler.bind(provider));

        return pairEntry;
}





async function logHandler(log) {
    try {
        const comparatorEntry = getComparatorEntryFromPairAddress(log.address);
        if (!comparatorEntry || !comparatorEntry.pairAddresses[log.address]){
            console.log("TODO handle WTF no matching pair address in database...", log.address);
            return;
        }
        let pairEntry = comparatorEntry.pairAddresses[log.address];
        let comparatorFiatTokenTracker = comparatorEntry.fiatTokenTracker;
        
        const transaction = await this.getTransaction(log.transactionHash); //provider is bound to this
        const parsedLog = pairEntry.pairContract.interface.parseLog(log);

        let wasBuy;
        let tokenAmount;
        let comparatorAmount;
        if (pairEntry.isTokenToken0){
            wasBuy = !parsedLog.args.amount1In.isZero();
            tokenAmount = wasBuy ? parsedLog.args.amount0Out : parsedLog.args.amount0In;
            comparatorAmount = wasBuy ? parsedLog.args.amount1In : parsedLog.args.amount1Out;
        } else {
            wasBuy = !parsedLog.args.amount0In.isZero();
            tokenAmount = wasBuy ? parsedLog.args.amount1Out : parsedLog.args.amount1In;
            comparatorAmount = wasBuy ? parsedLog.args.amount0In : parsedLog.args.amount0Out;
        } 

        const comparatorFiatPriceInfo = comparatorFiatTokenTracker.getLastPriceInfo();
        const tokenAmountRational = bigRational(tokenAmount.toString()).divide(bigRational('10').pow(pairEntry.tokenDecimals));
        const comparatorAmountRational = bigRational(comparatorAmount.toString()).divide(bigRational('10').pow(pairEntry.comparatorDecimals));
        const fiatAmountRational = comparatorAmountRational.multiply(comparatorFiatPriceInfo.fiatPerToken);
        const tokenPriceInComparator = comparatorAmountRational.divide(tokenAmountRational);
        const tokenPriceInFiat = fiatAmountRational.divide(tokenAmountRational);
        
        let action = wasBuy ? SWAP_TYPE.BUY : SWAP_TYPE.SELL ;
        pairEntry.swapHistory.push({
            transactionHash: log.transactionHash,
            from: transaction.from,
            action, 
            tokenAmountRational,
            comparatorAmountRational, 
            fiatAmountRational,
            fiatAmountRational,
            tokenPriceInComparator,
            tokenPriceInFiat, 
        });

        pairEntry.emitter.emit(SWAP_EVENT, pairEntry, pairEntry.swapHistory[pairEntry.swapHistory.length-1]);
    } catch {

    }
 };





function  getComparatorEntryFromPairAddress(pairAaddress){
    for (let endpoint of Object.keys(database.endpoints)){
        for (let factoryAddress of Object.keys(database.endpoints[endpoint].factoryAddresses)){
            const factoryEntry = database.endpoints[endpoint].factoryAddresses[factoryAddress];
            for (let comparatorAddress of Object.keys(factoryEntry.comparatorAddresses)){
                for (let pAddress of Object.keys(factoryEntry.comparatorAddresses[comparatorAddress].pairAddresses)){
                    if (pAddress === pairAaddress){
                        return factoryEntry.comparatorAddresses[comparatorAddress];
                    }
                }
            }
        }
    }
}

















async function createSimpleFiatTracker(endpoint, factoryAddress, fiatAddress, tokenAddress){
    const provider = database.endpoints[endpoint].provider;
    const sendOne = database.endpoints[endpoint].sendOne;
    const factoryContract = ABI.createFactoryContract(provider, factoryAddress);
    const pairAddress = await sendOne(factoryContract, 'getPair', tokenAddress, fiatAddress);
    const pairContract = ABI.createPairContract(provider, pairAddress);
    
    const [token0Address, token1Address] = await Promise.all([
        sendOne(pairContract, 'token0'),
        sendOne(pairContract, 'token1'),
    ]);
   
    const isTokenToken0 = token0Address === tokenAddress;
    const fiatContract = ABI.createTokenContract(provider, fiatAddress);
    const tokenContract = ABI.createTokenContract(provider, tokenAddress);

    const [tokenDecimals, tokenSymbol, fiatDecimals, fiatSymbol] = await Promise.all([
        sendOne(tokenContract, 'decimals'),
        sendOne(tokenContract, 'symbol'),
        sendOne(fiatContract, 'decimals'),
        sendOne(fiatContract, 'symbol'),
    ]);
    const token0Decimals = isTokenToken0 ? tokenDecimals : fiatDecimals;
    const token1Decimals = isTokenToken0 ? fiatDecimals : tokenDecimals;

    const fiatPerToken = await getCurrentPrice(pairContract, token0Decimals, token1Decimals, isTokenToken0, sendOne);
    const tokenPerFiat = bigRational('1').divide(fiatPerToken);
    
    const tokenTracker = {};
    tokenTracker.pairAddress = pairAddress;
    tokenTracker.pairContract = pairContract;
    tokenTracker.token0Address = token0Address;
    tokenTracker.token1Address = token1Address;
    tokenTracker.isTokenToken0 = isTokenToken0;
    tokenTracker.tokenDecimals = tokenDecimals;
    tokenTracker.tokenSymbol = tokenSymbol;
    tokenTracker.fiatDecimals = fiatDecimals;
    tokenTracker.fiatSymbol = fiatSymbol;
    tokenTracker.priceHistory = [{fiatPerToken, tokenPerFiat}],

    tokenTracker.getLastPriceInfo = function(){
        return  tokenTracker.priceHistory[tokenTracker.priceHistory.length - 1];
    }

    pairContract.on('Swap', async (senderAddress, amount0In, amount1In, amount0Out, amount1Out, toAddress) => {
        const fiatPerToken = await getCurrentPrice(pairContract, token0Decimals, token1Decimals, isTokenToken0, sendOne);
        const tokenPerFiat = bigRational('1').divide(fiatPerToken);
        tokenTracker.priceHistory.push({fiatPerToken, tokenPerFiat})
    });

    tokenTracker.stopListening = function(){
        pairContract.off('Swap');
    }

    return tokenTracker;
};







async function getCurrentPrice(pairContract, token0Decimals, token1Decimals, isTokenToken0, sendOneFunc){
    let reserves = await sendOneFunc(pairContract, 'getReserves');
    const amount0AsRational = bigRational(reserves.reserve0.toString()).divide(bigRational('10').pow(token0Decimals));
    const amount1AsRational = bigRational(reserves.reserve1.toString()).divide(bigRational('10').pow(token1Decimals));
    return isTokenToken0 ? amount1AsRational.divide(amount0AsRational) : amount0AsRational.divide(amount1AsRational);
}
























