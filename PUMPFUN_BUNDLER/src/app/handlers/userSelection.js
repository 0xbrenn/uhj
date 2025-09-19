const { PF_getNewMintKey } = require("../../API/PF_API/API");
const {     
    createToken,
    simulateBuyPumpfunTokens,
    buyPumpfunTokens,
    generatePumpfunKey,
    gatherSol,
    checkWallets,
    sellAllTokens,
    checkSol,
    sellTokens,
    generateKeys,
    buyDelayPumpfunTokens,
    sellPercentageOfTokens,
    sellPercentTokens,
    splitTokensToWallets,
    testUpload,
    supportBuys,
    sellSupportTokens,
    gatherSupportSol,
    claimSOLFromMiddleWallets,
    singleBuy,
    singleSell,
    askQuestion,
    singleDeploy,
    singleDeploySimple,
    PF_NATIVE_deploySingle,
    rl } = 
    require("../../bot");
const { getConfig } = require("../../configs/configSettings");

const getKeypairFromBase58 = async (pk) => {
    return Keypair.fromSecretKey(bs58.decode(pk));
}


// empty for now




