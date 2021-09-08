const ethers = require('ethers');
const ABI = require('./ABI');
const bigRational = require("big-rational");
const { RateLimiter } = require("limiter");
const EventEmitter = require('events');
const fs = require('fs');
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = (query) => new Promise((resolve) => rl.question(query, resolve));
process.title = "Euler's Hertz Feed"

const SWAP_TYPE = {BUY: "BUY", SELL: "SELL"};
const SWAP_EVENT = "SWAP_EVENT";
const globalEmitter = new EventEmitter();

//database stuff
const NODE_TYPE = {ENDPOINT: "ENDPOINT", FACTORY: "FACTORY", TOKEN: "TOKEN"};
let idToNode = {}
const endpointToNode = {};
let idTracker = 0;





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
        endpoint = "https://apis.ankr.com/e501c03064e7453f9e76b57bd80aa1cd/4b7b909b5596505a954a45acc3173c92/fantom/full/main";
    }
    
    if (fs.existsSync('snapshot.json')){
        console.log('- Reading in snapshot');
        await readInSnapshot('snapshot.json');
    } 


    const spookyFactorAddress = '0x152eE697f2E276fA89E96742e9bB9aB1F2E61bE3';
    const xdaoFactoryAddress = '0xcb9ea67a5eb76d22688bf21d6689c435d4e25077';

    console.log('- Adding endpoints');
    const endpointNode = getEndpointNode({endpoint});

    console.log('- Adding factories');
    const spookyFactoryNode = getFactoryNode({endpoint, address: spookyFactorAddress});
    const xdaoFactoryNode = getFactoryNode({endpoint, address: xdaoFactoryAddress});

    console.log('- Adding comparator chains');
    const usdcComparator = await getPairNode({
        endpoint, factoryAddress: spookyFactorAddress, 
        tokenAddress: '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75'
    });
    const ftmComparator = await getPairNode({
        endpoint, factoryAddress: spookyFactorAddress, 
        tokenAddress: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83', comparatorNodeId: usdcComparator.ID
    });
    const wethComparator = await getPairNode({
        endpoint, factoryAddress: spookyFactorAddress, 
        tokenAddress: '0x74b23882a30290451A17c44f4F05243b6b58C76d', comparatorNodeId: ftmComparator.ID
    });
    const chainlinkComparator = await getPairNode({
        endpoint, factoryAddress: spookyFactorAddress, 
        tokenAddress: '0xb3654dc3d10ea7645f8319668e8f54d2574fbdc8', comparatorNodeId: ftmComparator.ID
    });
    const curveComparator = await getPairNode({
        endpoint, factoryAddress: spookyFactorAddress, 
        tokenAddress: '0x1E4F97b9f9F913c46F1632781732927B9019C68b', comparatorNodeId: ftmComparator.ID
    });
    const bandComparator = await getPairNode({
        endpoint, factoryAddress: spookyFactorAddress, 
        tokenAddress: '0x46E7628E8b4350b2716ab470eE0bA1fa9e76c6C5', comparatorNodeId: ftmComparator.ID
    });
    const iFusdComparator = await getPairNode({
        endpoint, factoryAddress: xdaoFactoryAddress, 
        tokenAddress: '0x9fc071ce771c7b27b7d9a57c32c0a84c18200f8a', //need to find ifusd to usdc link (not on xdao or spooky)
        linkedToFiat: false
    });


    console.log('- Adding pairs');
    const hertzFtmPairNode = await getPairNode({
        endpoint, factoryAddress: xdaoFactoryAddress, 
        tokenAddress: '0x68F7880F7af43a81bEf25E2aE83802Eb6c2DdBFD', comparatorNodeId: ftmComparator.ID
    });
    const hertzUsdcPairNode = await getPairNode({
        endpoint, factoryAddress: xdaoFactoryAddress, 
        tokenAddress: '0x68F7880F7af43a81bEf25E2aE83802Eb6c2DdBFD', comparatorNodeId: usdcComparator.ID
    });
    const hertzWethPairNode = await getPairNode({
        endpoint, factoryAddress: xdaoFactoryAddress, 
        tokenAddress: '0x68F7880F7af43a81bEf25E2aE83802Eb6c2DdBFD', comparatorNodeId: wethComparator.ID
    });
    const hertzChainlinkPairNode = await getPairNode({
        endpoint, factoryAddress: xdaoFactoryAddress, 
        tokenAddress: '0x68F7880F7af43a81bEf25E2aE83802Eb6c2DdBFD', comparatorNodeId: chainlinkComparator.ID
    });
    const hertzCurvePairNode = await getPairNode({
        endpoint, factoryAddress: xdaoFactoryAddress, 
        tokenAddress: '0x68F7880F7af43a81bEf25E2aE83802Eb6c2DdBFD', comparatorNodeId: curveComparator.ID
    });
    const hertzBandPairNode = await getPairNode({
        endpoint, factoryAddress: xdaoFactoryAddress, 
        tokenAddress: '0x68F7880F7af43a81bEf25E2aE83802Eb6c2DdBFD', comparatorNodeId: bandComparator.ID
    });
    const hertzIFusdPairNode = await getPairNode({
        endpoint, factoryAddress: xdaoFactoryAddress, 
        tokenAddress: '0x68F7880F7af43a81bEf25E2aE83802Eb6c2DdBFD', comparatorNodeId: iFusdComparator.ID
    });

    console.log("- Writing snapshot out");
    writeOutSnapshot('snapshot.json');




    console.log(`Current Price: ${hertzFtmPairNode.lastKnownPriceInComparator.toDecimal(8)} ${idToNode[hertzFtmPairNode.comparatorNodeId].symbol} ($${hertzFtmPairNode.lastKnownPriceInFiat.toDecimal(8)})`);
    //console.log(`Current Price: ${hertzWethPairNode.lastKnownPriceInComparator.toDecimal(8)} ${idToNode[hertzWethPairNode.comparatorNodeId].symbol} ($${hertzWethPairNode.lastKnownPriceInFiat.toDecimal(8)})`);
    console.log("OK. Listening for trades...\n");

    hertzFtmPairNode.JS.startListening();
    hertzUsdcPairNode.JS.startListening();
    hertzWethPairNode.JS.startListening();
    hertzChainlinkPairNode.JS.startListening();
    hertzCurvePairNode.JS.startListening();
    hertzBandPairNode.JS.startListening();
    hertzIFusdPairNode.JS.startListening();

    globalEmitter.on(SWAP_EVENT, async (pairNode, swapInfo) => {
        const comparatorNode = idToNode[pairNode.comparatorNodeId];
        let outputString = `Transaction: https://ftmscan.com/tx/${swapInfo.transactionHash}\n${swapInfo.action}: `;
        outputString += `${swapInfo.tokenAmountRational.toDecimal(8)} ${pairNode.symbol} for `
        outputString +=  `${swapInfo.comparatorAmountRational.toDecimal(8)} ${comparatorNode.symbol} `;
        if (comparatorNode.linkedToFiat){
            outputString += `($${swapInfo.fiatAmountRational.toDecimal(8)})\n`;
            outputString += `Current Price: ${swapInfo.tokenPriceInComparator.toDecimal(8)} ${comparatorNode.symbol} ($${swapInfo.tokenPriceInFiat.toDecimal(8)})\n`;
        } else {
            outputString += `\nCurrent Price: ${swapInfo.tokenPriceInComparator.toDecimal(8)} ${comparatorNode.symbol}\n`;
        }
       
        console.log(outputString);
    });

}
(() => {init();})();


async function readInSnapshot(filename){
    const json = JSON.parse(fs.readFileSync(filename).toString('utf-8'));
    idTracker = Number(json.idTracker);
    idToNode = json.idToNode;
    let endpoints = [], factories = [], tokens = [];
   
    for (node of Object.values(idToNode)){
        if (node.TYPE === NODE_TYPE.ENDPOINT){
            endpoints.push(node);
        } else if (node.TYPE === NODE_TYPE.FACTORY){
            factories.push(node);
        } else if (node.TYPE === NODE_TYPE.TOKEN){
            tokens.push(node);
        }
    }
   
    for (let node of endpoints){
        node.JS = getJSComponent(node);
        endpointToNode[node.endpoint] = node;
    }
    for (let node of factories){
        node.JS = getJSComponent(node);
    }
    const tokenIdsDone = [];
    while (tokens.length){
        for (let i = tokens.length - 1; i >= 0; i--) {
            const node = tokens[i];
            if (!node.comparatorNodeId || tokenIdsDone.includes(node.comparatorNodeId)){
                let symbolString = node.symbol;
                if (node.comparatorNodeId){
                    symbolString += `-${idToNode[node.comparatorNodeId].symbol}`;
                }
                console.log(`    - ${symbolString}`);
                node.JS = getJSComponent(node);
                tokens.splice(i, 1);
                tokenIdsDone.push(node.ID);
                node.lastKnownPriceInComparator = bigRational(node.lastKnownPriceInComparator.num, node.lastKnownPriceInComparator.denom);
                node.lastKnownPriceInFiat = bigRational(node.lastKnownPriceInFiat.num, node.lastKnownPriceInFiat.denom);
                //await node.JS.updatePriceInComparatorFromContract();
            }
        }
    }
}


//parents must exist! (i.e. do endpoints before factories, and factories before comparator tokens, 
//and comparator tokens before tokens)
function getJSComponent(node){
    if (node.TYPE === NODE_TYPE.ENDPOINT){
        const limiter =  new RateLimiter({ tokensPerInterval: 2, interval: "second" });
        return {
            provider:  new ethers.providers.JsonRpcProvider(node.endpoint),
            sendOne:  async function(obj, functionName, ...args){
                const remainingRequests = await limiter.removeTokens(1);
                return obj[functionName](...args);
            },
        }
    } else if (node.TYPE === NODE_TYPE.FACTORY){
        const endpointNode = idToNode[node.ENDPOINT_ID];
        return {
            contract: ABI.createFactoryContract(endpointNode.JS.provider, node.address),
        }
    } else if (node.TYPE === NODE_TYPE.TOKEN){
        const endpointNode = idToNode[idToNode[node.FACTORY_ID].ENDPOINT_ID];
        const contract = ABI.createTokenContract(endpointNode.JS.provider, node.tokenAddress);
        const pairContract = node.pairAddress && ABI.createPairContract(endpointNode.JS.provider, node.pairAddress);
        const js = {
            contract,
            pairContract,
            swapHistory: [],
            emitter: new EventEmitter(),

            updatePriceInComparatorFromContract: async function(){
                if (!node.comparatorNodeId){
                    node.msAtLastPriceUpdate = Date.now();
                    return bigRational(1);
                }
                const comparatorNode = idToNode[node.comparatorNodeId];
                const token0Decimals = node.isToken0WithComparator ? node.decimals : comparatorNode.decimals;
                const token1Decimals = node.isToken0WithComparator ? comparatorNode.decimals : node.decimals;
                let reserves = await endpointNode.JS.sendOne(pairContract, 'getReserves');
                const amount0AsRational = bigRational(reserves.reserve0.toString()).divide(bigRational('10').pow(token0Decimals));
                const amount1AsRational = bigRational(reserves.reserve1.toString()).divide(bigRational('10').pow(token1Decimals));
                
                const priceInComparator = node.isToken0WithComparator ? amount1AsRational.divide(amount0AsRational) : amount0AsRational.divide(amount1AsRational);
                let lastKnownPriceInFiat = priceInComparator;
                let uplinkComparatorNode = comparatorNode
                const currentSeconds = Date.now();
                while (uplinkComparatorNode){
                    if (currentSeconds - uplinkComparatorNode.msAtLastPriceUpdate > 30000){
                        await uplinkComparatorNode.JS.updatePriceInComparatorFromContract();
                    }                
                    lastKnownPriceInFiat = lastKnownPriceInFiat.multiply(uplinkComparatorNode.lastKnownPriceInComparator);
                   
                    uplinkComparatorNode = idToNode[uplinkComparatorNode.comparatorNodeId];
                }
                node.lastKnownPriceInComparator = priceInComparator;
                node.lastKnownPriceInFiat = lastKnownPriceInFiat;
                node.msAtLastPriceUpdate = Date.now();
                return priceInComparator;
            },
            logHandler: async function(log){
                const comparatorNode = idToNode[node.comparatorNodeId]
                        
                const transaction = await endpointNode.JS.provider.getTransaction(log.transactionHash); //provider is bound to this
                const parsedLog = node.JS.pairContract.interface.parseLog(log);
            
                let wasBuy;
                let tokenAmount;
                let comparatorAmount;
                if (node.isToken0WithComparator){
                    wasBuy = !parsedLog.args.amount1In.isZero();
                    tokenAmount = wasBuy ? parsedLog.args.amount0Out : parsedLog.args.amount0In;
                    comparatorAmount = wasBuy ? parsedLog.args.amount1In : parsedLog.args.amount1Out;
                } else {
                    wasBuy = !parsedLog.args.amount0In.isZero();
                    tokenAmount = wasBuy ? parsedLog.args.amount1Out : parsedLog.args.amount1In;
                    comparatorAmount = wasBuy ? parsedLog.args.amount0In : parsedLog.args.amount0Out;
                } 
            
                const tokenAmountRational = bigRational(tokenAmount.toString()).divide(bigRational('10').pow(node.decimals));
                const comparatorAmountRational = bigRational(comparatorAmount.toString()).divide(bigRational('10').pow(comparatorNode.decimals));
                const lastKnownPriceInComparator = comparatorAmountRational.divide(tokenAmountRational);
                let lastKnownPriceInFiat = lastKnownPriceInComparator;
                let uplinkComparatorNode = comparatorNode
                const currentSeconds = Date.now();
                while (uplinkComparatorNode){
                    if (currentSeconds - uplinkComparatorNode.msAtLastPriceUpdate > 30000){
                        await uplinkComparatorNode.JS.updatePriceInComparatorFromContract();
                    } 
                    lastKnownPriceInFiat = lastKnownPriceInFiat.multiply(uplinkComparatorNode.lastKnownPriceInComparator);
                    uplinkComparatorNode = idToNode[uplinkComparatorNode.comparatorNodeId];
                }
                const fiatAmountRational = lastKnownPriceInFiat.multiply(tokenAmountRational);
                
                node.lastKnownPriceInComparator = lastKnownPriceInComparator;
                node.lastKnownPriceInFiat = lastKnownPriceInFiat;
                node.msAtLastPriceUpdate = Date.now();
            
                let action = wasBuy ? SWAP_TYPE.BUY : SWAP_TYPE.SELL ;
                node.JS.swapHistory.push({
                    transactionHash: log.transactionHash,
                    from: transaction.from,
                    action, 
                    tokenAmountRational,
                    comparatorAmountRational, 
                    fiatAmountRational,
                    tokenPriceInComparator: lastKnownPriceInComparator,
                    tokenPriceInFiat: lastKnownPriceInFiat, 
                });
            
                node.JS.emitter.emit(SWAP_EVENT, node, node.JS.swapHistory[node.JS.swapHistory.length-1]);
                globalEmitter.emit(SWAP_EVENT, node, node.JS.swapHistory[node.JS.swapHistory.length-1]);
             }
        };
        js.startListening = function(){
            endpointNode.JS.provider.on(node.eventFilter, js.logHandler);
        };
        js.stopListening = function(){
            endpointNode.JS.provider.off(node.eventFilter, js.logHandler);
        };
        return js;
    }
}



function writeOutSnapshot(filename){
    const idToNodeCopy = {};
    for (let id of Object.keys(idToNode)){
        const node = {...idToNode[id]};
        delete node.JS;
        idToNodeCopy[id] = node;
    }
    fs.writeFileSync(filename, JSON.stringify({idToNode: idToNodeCopy, idTracker}, null," "));
}



function getEndpointNode({endpoint}){
    if (endpointToNode[endpoint]){
        return endpointToNode[endpoint];
    }
    const node = {
        TYPE: NODE_TYPE.ENDPOINT, 
        ID: (idTracker++).toString(),
        FACTORY_IDS: [],
        endpoint,
    };
    node.JS = getJSComponent(node);
    
    endpointToNode[endpoint] = node;
    idToNode[node.ID] = node;
    return node;
}

function getFactoryNode({endpoint, address}){
    let endpointNode = getEndpointNode({endpoint});
    for (const id of endpointNode.FACTORY_IDS){
        if (idToNode[id].address === address){
            return idToNode[id];
        } 
    }

    const node = {
        TYPE: NODE_TYPE.FACTORY, 
        ID: (idTracker++).toString(),
        ENDPOINT_ID: endpointNode.ID,
        TOKEN_IDS: [],
        address
    };
    node.JS = getJSComponent(node);
    endpointNode.FACTORY_IDS.push(node.ID);
    idToNode[node.ID] = node;
    return node;
}


//the factoryAddress should be the factory that holds the address-comparatorAddress pair
//give no comparatorNodeId for fiat (ie the end of a comparator chain)
//linkedToFiat is default true, unless the comparator node isn't linkedToFia
async function getPairNode({endpoint, factoryAddress, tokenAddress, comparatorNodeId, linkedToFiat}){
    let endpointNode = getEndpointNode({endpoint});
    let factoryNode = getFactoryNode({endpoint, address: factoryAddress});
    for (const id of factoryNode.TOKEN_IDS){
        if (idToNode[id].tokenAddress === tokenAddress && idToNode[id].comparatorNodeId === comparatorNodeId){
            return idToNode[id];
        } 
    }

    const comparatorNode = idToNode[comparatorNodeId];
    linkedToFiat = (linkedToFiat || linkedToFiat === undefined) && (!comparatorNode || comparatorNode.linkedToFiat);
    const contract = ABI.createTokenContract(endpointNode.JS.provider, tokenAddress);

    const sendOne = endpointNode.JS.sendOne;
    
    const [decimals, symbol, pairAddress] = await Promise.all([
        sendOne(contract, 'decimals'),
        sendOne(contract, 'symbol'),
        comparatorNodeId && sendOne(factoryNode.JS.contract, 'getPair', tokenAddress, comparatorNode.tokenAddress),
    ]);

    const pairContract = comparatorNodeId && ABI.createPairContract(endpointNode.JS.provider, pairAddress);
    const isToken0WithComparator = comparatorNodeId && ((await sendOne(pairContract, 'token0')) === tokenAddress);

    const node = {
        TYPE: NODE_TYPE.TOKEN, 
        ID: (idTracker++).toString(),
        FACTORY_ID: factoryNode.ID,
        tokenAddress,
        decimals,
        symbol,
        comparatorNodeId,
        pairAddress,
        isToken0WithComparator,
        msAtLastPriceUpdate: 0,
        linkedToFiat,
        lastKnownPriceInComparator: bigRational(1),
        lastKnownPriceInFiat: bigRational(1),
        eventFilter: {
            address: [pairAddress],
            topics: [ethers.utils.id("Swap(address,uint256,uint256,uint256,uint256,address)")]
        },
    };
    node.JS = getJSComponent(node);
    await node.JS.updatePriceInComparatorFromContract();

    let lastKnownPriceInFiat = node.lastKnownPriceInComparator;
    let uplinkComparatorNode = comparatorNode
    while (uplinkComparatorNode){
        lastKnownPriceInFiat = lastKnownPriceInFiat.multiply(uplinkComparatorNode.lastKnownPriceInComparator);
        uplinkComparatorNode = idToNode[uplinkComparatorNode.comparatorNodeId];
    }
    node.lastKnownPriceInFiat = lastKnownPriceInFiat;
    
    let outputString = node.symbol;
    if (comparatorNodeId){
        outputString += `-${idToNode[comparatorNodeId].symbol}`;
        outputString += ` (1 ${node.symbol} = ${node.lastKnownPriceInComparator.toDecimal(8)} ${comparatorNode.symbol})`;
    }

    console.log(`    - ${outputString}`);

    idToNode[node.ID] = node;
    factoryNode.TOKEN_IDS.push(node.ID);
    return node;
}

















