require('rpc-websockets/dist/lib/client')
const dotenv = require("dotenv");
const axios = require("axios");

const fsp = require("fs/promises");
const fs = require("fs");
const chalk = require('chalk');
const fetch = require("node-fetch"); // Fetch for Node.js
const path = require("path");
const readline = require('readline');


const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
const askQuestion = (query) => {
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            resolve(answer);
        });
    });
};
const { Blob } = require('buffer');
const {
    clusterApiUrl,
    Connection,
    VersionedTransaction,
    Keypair,
    LAMPORTS_PER_SOL,
    TransactionMessage,
    SystemProgram,
    PublicKey,
    SYSVAR_RENT_PUBKEY,
    Transaction,
    SendTransactionError
} = require("@solana/web3.js");
const {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createTransferInstruction,
    getAssociatedTokenAddressSync,
    getAssociatedTokenAddress
} = require("@solana/spl-token");

const {
    PF_getNewMintKey,
    PF_signCreateTx,            
    decodeSerializedTransaction
} = require("./API/PF_API/API");
const FormData = require('form-data');
const BN = require("bn.js");
const {
    bundle: { Bundle },
    searcher: { searcherClient },
} = require("jito-ts");
const bs58 = require('bs58');

const anchor = require('@project-serum/anchor');
dotenv.config();
const { readFileSync, writeFileSync, existsSync } = require("fs");
const idl = require("../idl.json");
const { getTipAccounts, sendBundles } = require('./bundle');
const { sendFastBundles } = require('./fastbundle');
const { GLOBAL_useNativeToken, CONFIG_updateLastUsedToken, CONFIG_lastUsedToken } = require('./configs/utils');
const RPC_URL = process.env.RPC_URL;
const connection = new Connection(
    RPC_URL,
    'confirmed',
);


const INSTRUCTION_PER_TX = 5;
const MAX_RETRY = 3;
const PUMPFUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const DEV_PERCENT = parseFloat(process.env.MINTER_PERCENT) || 3;
const MIN_PERCENT = parseFloat(process.env.MIN_PERCENT) || 20;
const MAX_PERCENT = parseFloat(process.env.MAX_PERCENT) || 20;
const WALLET_COUNT = parseInt(process.env.WALLET_COUNT) || 15;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// const JITO_CLIENT = searcherClient(process.env.BLOCK_ENGINE_URL, AUTH_SECRET_KEYPAIR);
const JITO_TIP = parseFloat(process.env.JITO_TIP);

// KRYPTIC WALLET (used for SOL distribution)
const KRYPTIC_SECRET = bs58.decode(process.env.PARENT_KRYPTIC_KEY);
const KRYPTIC = Keypair.fromSecretKey(KRYPTIC_SECRET);
const KRYPTIC_ADDRESS = KRYPTIC.publicKey;

// MAIN WALLET (used for signing transactions like buys)
const PAYER_SECRET = bs58.decode(process.env.MINTER_KEY);
const PAYER = Keypair.fromSecretKey(PAYER_SECRET);
const PAYER_ADDRESS = PAYER.publicKey;

// Other program constants
const EVENT_AUTH = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
const feeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");


const getConfig = () => {
    const configDir = path.join(__dirname, '../configs');
    const defaultConfigPath = path.join(configDir, 'defaultConfig.json');

    try {
        const configData = fs.readFileSync(defaultConfigPath, 'utf-8');
        const config = JSON.parse(configData);

        // Check TOKEN_PK based on PF_useNative
        const useNative = config.PF_useNative || false;

        if (!useNative && (!config.TOKEN_PK || config.TOKEN_PK.trim() === '')) {
            console.log(chalk.bgRedBright("\n⚠️  ERROR: No TOKEN_PK found in config and PF_useNative is false."));
            console.log(chalk.yellowBright("\nUse option '2' from the menu to generate a new contract address or manually update 'configs/defaultConfig.json'."));
            return null; // Return null to stop the app elsewhere
        }

        return config;
    } catch (error) {
        console.error("⚠️ Error reading defaultConfig.json:", error);
        return null;
    }
};



async function testUpload() {
    try {
        // Resolve file path
        const filePath = `./img/${process.env.TOKEN_IMAGE_URL}`; // Corrected file path
        const fileName = path.basename(filePath); // Extract file name

        // Read the file as Buffer
        const fileBuffer = await fsp.readFile(filePath);

        // Initialize FormData and append file with correct filename
        const formData = new FormData();
        formData.append("file", fileBuffer, fileName); // Append file with filename
        formData.append("name", process.env.TOKEN_NAME || "MyToken");
        formData.append("symbol", process.env.TOKEN_SYMBOL || "MTK");
        formData.append("description", process.env.TOKEN_DESCRIPTION || "A sample token.");
        formData.append("twitter", process.env.TOKEN_TWITTER || "https://twitter.com/mytoken");
        formData.append("telegram", process.env.TOKEN_TELEGRAM || "https://t.me/mytoken");
        formData.append("website", process.env.TOKEN_WEBSITE || "https://mytoken.com");
        formData.append("showName", "true");

        console.log("Uploading metadata to IPFS...");

        // Make HTTP request
        const response = await fetch("https://pump.fun/api/ipfs", {
            method: "POST",
            body: formData,
            headers: formData.getHeaders(), // Ensure correct headers
        });

        // Check for errors
        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }

        const jsonResponse = await response.json();
        console.log("Upload Success:", jsonResponse.metadataUri);
        return jsonResponse.metadataUri
    } catch (error) {
        console.error("Error:", error.message);
    }
}




const gatherSol = async () => {
    const keysFile = getConfig().keysFile;
    let krypticWallets = [];
    if (existsSync(keysFile))
        krypticWallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' })) || [];
    const transactionPromises = [];
    const maxRetries = 3;

    const sendTransactionWithRetry = async (versionedTransaction, walletIndex, attempt = 0) => {
        try {
            const txId = await connection.sendTransaction(versionedTransaction);
            await connection.confirmTransaction(txId);
            console.log(`Transaction sent and confirmed: ${txId}`);
        } catch (error) {
            if (attempt < maxRetries) {
                console.warn(`Error sending transaction for wallet ${walletIndex}, attempt ${attempt + 1}:`, error);
                await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000)); // Wait before retrying
                return sendTransactionWithRetry(versionedTransaction, walletIndex, attempt + 1);
            } else {
                console.error(`Transaction failed for wallet ${walletIndex} after ${maxRetries} attempts:`, error);
            }
        }
    };

    for (let i = 0; i < krypticWallets.length; i++) {
        const privateKey = krypticWallets[i]['key']
        const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
        const solAmount = await connection.getBalance(keypair.publicKey)
        if (solAmount == 0) continue
        const instructions = SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: KRYPTIC_ADDRESS,
            lamports: solAmount
        })
        const versionedTransaction = new VersionedTransaction(
            new TransactionMessage({
                payerKey: KRYPTIC_ADDRESS,
                recentBlockhash: ((await connection.getLatestBlockhash()).blockhash),
                instructions: [instructions],
            }).compileToV0Message()
        )
        versionedTransaction.sign([KRYPTIC, keypair])
        const transactionPromise = sendTransactionWithRetry(versionedTransaction, i);
        transactionPromises.push(transactionPromise);
    }
    await Promise.all(transactionPromises);

    console.log('Gathering is completed.');
}

const gatherSupportSol = async () => {
    const keysFile = 'supportKeys.json';
    let supportWallets = [];

    if (existsSync(keysFile))
        supportWallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' })) || [];
    else {
        console.log(chalk.redBright("❌ No support wallets found."));
        return;
    }

    console.log(chalk.blueBright(`📂 Found wallets`));

    const transactionPromises = [];
    const maxRetries = 3;
    const MIN_BALANCE = 5000; // Leave 5000 lamports behind (0.000005 SOL)

    // Function to send transactions with retry
    const sendTransactionWithRetry = async (versionedTransaction, walletIndex, attempt = 0) => {
        try {
            const txId = await connection.sendTransaction(versionedTransaction);
            await connection.confirmTransaction(txId);
            console.log(`✅ Transaction sent and confirmed: ${txId}`);
        } catch (error) {
            if (attempt < maxRetries) {
                console.warn(`⚠️ Error sending transaction for wallet ${walletIndex}, attempt ${attempt + 1}:`, error);
                await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000)); // Wait before retrying
                return sendTransactionWithRetry(versionedTransaction, walletIndex, attempt + 1);
            } else {
                console.error(`❌ Transaction failed for wallet ${walletIndex} after ${maxRetries} attempts:`, error);
            }
        }
    };

    for (let i = 0; i < supportWallets.length; i++) {
        const privateKey = supportWallets[i]['key'];
        const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
        const solBalance = await connection.getBalance(keypair.publicKey);

        // Ensure there’s enough balance to send after leaving 5000 lamports
        if (solBalance <= MIN_BALANCE) {
            console.log(`⚠️ Wallet ${supportWallets[i]['name']} has insufficient SOL after leaving 5000 lamports, skipping.`);
            continue;
        }

        const solToSend = solBalance - MIN_BALANCE; // Leave 5000 lamports behind
        console.log(`📤 Sending ${(solToSend / LAMPORTS_PER_SOL).toFixed(6)} SOL from ${supportWallets[i]['name']}...`);

        const instructions = SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: KRYPTIC_ADDRESS,
            lamports: solToSend
        });

        const versionedTransaction = new VersionedTransaction(
            new TransactionMessage({
                payerKey: keypair.publicKey,
                recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
                instructions: [instructions],
            }).compileToV0Message()
        );

        versionedTransaction.sign([keypair]);

        const transactionPromise = sendTransactionWithRetry(versionedTransaction, i);
        transactionPromises.push(transactionPromise);
    }

    await Promise.all(transactionPromises);
    console.log(chalk.greenBright('✅ Gathering SOL from support wallets completed.'));
};




async function getTokenAccountBalance(
    walletAddress,
    mintAddress) {
    try {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            walletAddress,
            { mint: mintAddress }
        );

        if (!tokenAccounts)
            return 0;

        // Extract the token amount from the first account (if multiple accounts exist)
        const balance =
            tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.uiAmount;
        return balance || 0;
    } catch (e) {
        console.log("get token balance error: ", e);
        return -1;
    }
}

async function checkPumpfunAddress(mintAddr) {
    const accountExist = await checkTokenAccountExists(mintAddr);
    if (accountExist) {
        console.log("💥💥💥 Your TOKEN_PK is not new pump.fun PK. Please select not used pump.fun PK");
        return false;
    }
    return true;
}

const checkTokenAccountExists = async (tokenAccountAddress) => {
    try {
        const accountInfo = await connection.getAccountInfo(new PublicKey(tokenAccountAddress));
        return accountInfo !== null;
    } catch (e) {
        console.log("Error checking token account existence: ", e);
        return false;
    }
}

const getSafeTokenBalance = async (
    walletAddr,
    tokenMintAddr
) => {
    let tokenBalance = -1;
    while (1) {
        let checkExsit = await checkTokenAccountExists(tokenMintAddr);
        if (!checkExsit)
            return 0;
        tokenBalance = await getTokenAccountBalance(
            new PublicKey(walletAddr),
            new PublicKey(tokenMintAddr)
        );
        if (tokenBalance !== -1) break;
        await sleep(50);
    }
    return tokenBalance;
}

const checkWallets = async () => {
    const keysFile = getConfig().keysFile;
    let tokenMint;
    if (GLOBAL_useNativeToken()) {
        const lastUsed = CONFIG_lastUsedToken();
        if (!lastUsed) {
            console.log("❌ No last native token found.");
            process.exit(1);
        }
        tokenMint = new PublicKey(lastUsed);
    } else {
        const tokenAccount = await getKeypairFromBase58(getConfig().TOKEN_PK);
        tokenMint = tokenAccount.publicKey;
    }
    let walletInfo = [];
    walletInfo.push({ wallet: 'ParentKryptic', address:KRYPTIC_ADDRESS.toString() ,solAmount: await connection.getBalance(KRYPTIC_ADDRESS) / LAMPORTS_PER_SOL, tokenAmount: await getSafeTokenBalance(KRYPTIC_ADDRESS, tokenMint) });
    walletInfo.push({ wallet: 'Minter', address:PAYER_ADDRESS.toString(), solAmount: await connection.getBalance(PAYER_ADDRESS) / LAMPORTS_PER_SOL, tokenAmount: await getSafeTokenBalance(PAYER_ADDRESS, tokenMint) });
    let krypticWallets = [];
    if (existsSync(keysFile))
        krypticWallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' })) || [];
    for (let i = 0; i < krypticWallets.length; i++) {
        const privateKey = krypticWallets[i]['key']
        const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
        const solAmount = await connection.getBalance(keypair.publicKey)
        let temp = i + 1;
        walletInfo.push({ wallet: krypticWallets[i]['name'], address:krypticWallets[i]['address'], solAmount: solAmount / LAMPORTS_PER_SOL, tokenAmount: await getSafeTokenBalance(keypair.publicKey, tokenMint) })
    }
    console.table(walletInfo);
}

const getKeypairFromBase58 = async (pk) => {
    return Keypair.fromSecretKey(bs58.decode(pk));
}

const getMintAuthority = async (programId) => {
    const seedString = "mint-authority";

    const [PDA, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from(seedString)],
        programId
    );

    return new PublicKey(PDA);
}

const getBondingCurve = async (tokenMint, programId) => {
    const seedString = "bonding-curve";

    const [PDA, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from(seedString), tokenMint.toBuffer()],
        programId
    );

    return new PublicKey(PDA);
}

const calculateTokenAmounts = async (totalAmount, count) => {

    const equalAmount = parseInt(totalAmount / count)

    const tokenAmounts = []
    while (1) {
        let buyAmount = 0;
        for (let i = 0; i < count; i++) {
            const tokenAmount = equalAmount * ((Math.random() * 20 + 90) / 100)
            buyAmount += tokenAmount
            tokenAmounts.push(tokenAmount)
        }
        if (buyAmount <= totalAmount) return tokenAmounts
        else {
            tokenAmounts.length = 0
        }
    }
}

const calculateTokenAmountsMinMax = (totalAmount, count) => {
    const tokenAmouns = [];
    const spaceVal = MAX_PERCENT - MIN_PERCENT;
    for (let i = 0;i < count; i ++) {
        const percent = MIN_PERCENT + (Math.random()*spaceVal);
        const tokenAmount = totalAmount * (percent/100);
        tokenAmouns.push(tokenAmount);
    }
    return tokenAmouns;
}

const getMetadataAccount = async (tokenMint, programId) => {
    const seedString = "metadata";

    const [PDA, bump] = PublicKey.findProgramAddressSync(
        [
            Buffer.from(seedString),
            new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
            tokenMint.toBuffer(),
        ],
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
    );

    return new PublicKey(PDA);
}

const getSolAmountsSimulate = async (initSolReserve, initTokenReserve, tokenList) => {
    let tokenReserve = initTokenReserve;
    let solReserve = initSolReserve;
    const solAmounts = [];
  
    for (let i = 0; i < tokenList.length; i++) {
        const tokenAmount = tokenList[i];

        // Calculate the base SOL required for this purchase
        const baseSolAmount = await getAmountIn(tokenAmount, solReserve, tokenReserve);

        // Ensure we do not exceed 85 SOL beyond the initial 30 SOL
        if ((solReserve - initSolReserve) + baseSolAmount > 85) {
            console.log(chalk.redBright(`Stopping simulation at Kryptic${i} to avoid exceeding 85 additional SOL.`));
            break;
        }

        // Extra fees added for display purposes
        let displaySolAmount = baseSolAmount + 0.05; // 0.03 SOL fee per wallet
        if (i === 0) {
            displaySolAmount += 0.2; // Additional fee for the first wallet ("Minter")
        }
        solAmounts.push(displaySolAmount);

        // Update pool reserves with base swap amount
        tokenReserve -= tokenAmount;
        solReserve += baseSolAmount;
    }
  
    // Return the displayed SOL amounts along with the updated pool reserves
    return { solAmounts, finalSolReserve: solReserve, finalTokenReserve: tokenReserve };
};



  const updateKeysWithSimulation = (simulationInfo) => {
  const keysFile = getConfig().keysFile;
  let wallets = JSON.parse(fs.readFileSync(keysFile, 'utf8'));

  // Skip the first element of simulationInfo (the dev wallet) by starting at index 1.
  for (let i = 1; i < simulationInfo.length && (i - 1) < wallets.length; i++) {
    // Map simulationInfo[i] (which is Kryptic1, Kryptic2, etc.)
    // to wallets[i - 1] (which should match your keys file order).
    wallets[i - 1].expectedSolAmount = simulationInfo[i].SolAmount;
    wallets[i - 1].expectedTokenAmount = simulationInfo[i].TokenAmount;
  }

  fs.writeFileSync(keysFile, JSON.stringify(wallets, null, 2));
  console.log(chalk.greenBright("Updated keys file with simulation info (excluding dev wallet)."));
};

  const getAmountIn = async (amountOut, reserveIn, reserveOut) => {
    const numerator = reserveIn * amountOut * 1000;
    const denominator = (reserveOut - amountOut) * 990;
    const amountIn = numerator / denominator;
    return amountIn;
  };


  const getMarketCapUSD = (finalSolReserve, finalTokenReserve, totalTokenSupply, solPriceUSD) => {
    const tokenPriceInSOL = finalSolReserve / finalTokenReserve;
    const tokenPriceInUSD = tokenPriceInSOL * solPriceUSD;
    return totalTokenSupply * tokenPriceInUSD;
  };


  const simulateBuyPumpfunTokens = async () => {
    try {
      const virtualInitSolReserve = 30;
      const virtualInitTokenReserve = 1073000000; // Total token supply
  
      // Calculate the DEV wallet token allocation based on DEV_PERCENT.
      const devTokenAmount = parseInt((virtualInitTokenReserve / 100) * DEV_PERCENT);
  
      // Build the token amounts array:
      // The first element is for the DEV wallet, followed by amounts for other wallets.
      const tokenAmounts = [devTokenAmount].concat(
        calculateTokenAmountsMinMax(virtualInitTokenReserve, WALLET_COUNT)
      );
  
      // Run the simulation of token buys.
      const { solAmounts, finalSolReserve, finalTokenReserve } = await getSolAmountsSimulate(
        virtualInitSolReserve,
        virtualInitTokenReserve,
        tokenAmounts
      );
  
      let totalSol = solAmounts.reduce((acc, amount) => acc + amount, 0);
      totalSol += 0.1; // Additional Pumpfun Mint Token fee.
  
      // Calculate the updated market cap based on the final pool state.
      const solPriceUSD = process.env.SOL_PRICE; // Current SOL price in USD.
      const marketCapUSD = getMarketCapUSD(
        finalSolReserve,
        finalTokenReserve,
        virtualInitTokenReserve,
        solPriceUSD
      );
  
      // Calculate the total tokens that have been purchased (owned by wallets)
      // which is the initial token supply minus the tokens remaining in the pool.
      const totalTokensOwned = virtualInitTokenReserve - finalTokenReserve;
  
      // Prepare simulation info for display and to update keys file.
      // Note: For display, we set the first wallet as "Minter" (DEV) and the rest as "Kryptic1", "Kryptic2", etc.
      const simulationInfo = [];
      simulationInfo.push({
        Wallet: "Minter",
        TokenAmount: devTokenAmount,
        SolAmount: solAmounts[0]
      });
      for (let i = 1; i < tokenAmounts.length; i++) {
        simulationInfo.push({
          Wallet: "Kryptic" + i,
          TokenAmount: tokenAmounts[i],
          SolAmount: solAmounts[i]
        });
      }
  
      // Print header
      console.log(chalk.bold.bgBlue.white("=== PUMPFUN TOKEN LAUNCH SIMULATION RESULTS ==="));
      console.table(simulationInfo);
  
      // Print summary info with chalk colors.
      console.log(
        chalk.blueBright("Total SOL Contributed:"), 
        chalk.yellow(totalSol)
      );
      console.log(
        chalk.blueBright("Market Cap (USD) after simulation:"), 
        chalk.green(marketCapUSD.toFixed(2))
      );
      const percentageOwned = ((totalTokensOwned / virtualInitTokenReserve) * 100).toFixed(2);
      console.log(
        chalk.blueBright("Total Tokens Owned by wallets:"), 
        chalk.magenta(percentageOwned + " %")
      );
  
      // Update the keys file with simulation expected buy amounts.
      updateKeysWithSimulation(simulationInfo);
  
      
  
      return { simulationInfo, solAmounts, tokenAmounts, finalSolReserve, finalTokenReserve, totalTokensOwned };
    } catch (error) {
      console.log(chalk.red("Error:"), error);
    }
  };
  



const getBalance = async (walletPublicKey) => {
    if (connection === null || connection === undefined) return -1;

    try {
        const balance = await connection.getBalance(walletPublicKey);
        return balance;
    } catch (err) {
        console.log("get sol balance error: ", err);
        return -1;
    }
}



const getRandomNumber = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};



const getJitoTipInstruction = async (keypair) => {
    while (1) {
        try {

            const tipAccounts = await getTipAccounts();
            const tipAccount = new PublicKey(tipAccounts[getRandomNumber(0, tipAccounts.length - 1)]);


            return SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: tipAccount,
                lamports: JITO_TIP * LAMPORTS_PER_SOL,
            })

        } catch (error) {
            console.error('Jito Tip Instruction Error', error);
        }
        await sleep(100);
    }

}




const checkBundle = async (uuid) => {

    let count = 0;
    while (1) {
        try {
            const response = await (
                await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'getBundleStatuses',
                        params: [[uuid]]
                    })
                })
            ).json();
            if (response?.result?.value?.length == 1 && response?.result?.value[0]?.bundle_id) {
                console.log('Bundle Success:', uuid);
                return true;
            }
        } catch (error) {
            console.log('Check Bundle Failed', error);
        }

        await sleep(1000)
        count++;

        if (count == 30) {
            console.log('Bundle Failed:', uuid);
            return false;
        }
    }

}


const sendAndConfirmBundles = async (transactions) => {
    try {
        const _bundle = new Bundle(transactions, transactions.length);
        const uuid = await JITO_CLIENT.sendBundle(_bundle);
        console.log('Bundle UUID:', uuid.yellow);
        return await checkBundle(uuid);
    } catch (error) {
        console.log('Send And Confirm Bundle Error', error);
        return false;
    }
}

const buildMintIx = async (program, signerKeypair, tokenMint, tokenName, tokenSymbol, tokenUri) => {
    console.log("TEST");
    const mint = tokenMint;
    console.log("New Mint Address: ", mint.toString());
    const mintAuthority = await getMintAuthority(program.programId);
    const bondingCurve = await getBondingCurve(mint, program.programId);
    const bondingCurveAta = await getAssociatedTokenAddress(
        mint,
        bondingCurve,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const metadataAccount = await getMetadataAccount(mint, program.programId);

    const globalState = new PublicKey(
        "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    );
    const user = signerKeypair.publicKey;
    const mplTokenMetadata = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
    );

    //creating tx;

    const mintIx = await program.methods
    .create(tokenName, tokenSymbol, tokenUri, user)  // 👈 ADD `user` as the 4th arg
    .accounts({
            mint: mint,
            mintAuthority: mintAuthority,
            bondingCurve: bondingCurve,
            associatedBondingCurve: bondingCurveAta,
            global: globalState,
            mplTokenMetadata: mplTokenMetadata,
            metadata: metadataAccount,
            user: user,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            eventAuthority: EVENT_AUTH,
            program: program.programId,
        })
        .instruction();
    return mintIx;

} 
const generatePumpfunKey = async () => {
    const ending = process.env.END_TEXT;
    const length = parseInt(process.env.END_LENGTH, 10);
    const configPath = path.join(__dirname, '../configs', 'defaultConfig.json');

    console.log(`Generating Wallet Ending In ${ending}`);
    console.log(chalk.cyanBright("🔁 Press Ctrl+C or press 'q' to stop generation.\n"));

    let counter = 0;
    let stopped = false;

    const handleExit = () => {
        stopped = true;
        console.log(chalk.yellowBright("\n❌ Key generation stopped by user."));
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
    };

    process.on('SIGINT', handleExit);
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdin.on('keypress', (str, key) => {
        if (key && (key.name === 'q' || key.sequence === '\u0003')) { // 'q' or Ctrl+C
            stopped = true;
            console.log(chalk.yellowBright("\n❌ Key generation stopped by user."));
        }
    });

    const loop = async () => {
        while (!stopped) {
            try {
                const keypair = Keypair.generate();
                counter++;

                if (keypair.publicKey.toBase58().slice(-length) === ending) {
                    const pk = bs58.encode(keypair.secretKey);
                    console.log("🔑 New Pumpfun Key:", pk);

                    let config = {};
                    if (fs.existsSync(configPath)) {
                        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                    }

                    config.TOKEN_PK = pk;
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                    console.log("✅ Pumpfun Key saved to defaultConfig.json.");

                    if (process.stdin.isTTY) process.stdin.setRawMode(false);
                    return;
                }

                if (counter % 10000 === 0) {
                    console.log(`🚀 Generated ${counter} keys so far...`);
                }
            } catch (error) {
                console.log("⚠️ Error generating Pumpfun key:", error);
            }

            // Yield control to event loop so 'keypress' can be caught
            await new Promise((resolve) => setImmediate(resolve));
        }
    };

    await loop();
};



const buildBuyInstruction = async (program, signerKeypair, tokenMint, tokenAmount, solAmount) => {
    const mint = tokenMint;
    const bondingCurve = await getBondingCurve(mint, program.programId);
    const bondingCurveAta = await getAssociatedTokenAddress(
      mint,
      bondingCurve,
      true
    );
  
    const globalState = new PublicKey(
      "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    ); // fixed
    const user = signerKeypair.publicKey;
    const userAta = getAssociatedTokenAddressSync(mint, user, true);
    // Here signerTokenAccount is the same as userAta.
    const signerTokenAccount = getAssociatedTokenAddressSync(mint, user, true);
  
    //@ts-ignore
    const decimals = 6;
    //creating instructions;
    const instructions = [];
  
    // Check if the associated token account exists on-chain.
    const ataInfo = await program.provider.connection.getAccountInfo(userAta);
    if (!ataInfo) {
      // Only create the ATA if it doesn't exist.
      instructions.push(
        createAssociatedTokenAccountInstruction(
          user,
          signerTokenAccount,
          user,
          mint
        )
      );
    }
  
    const snipeIx = await program.methods
      .buy(
        new BN(tokenAmount * 10 ** decimals),
        new BN(parseInt(solAmount * LAMPORTS_PER_SOL))
      )
      .accounts({
        global: globalState,
        feeRecipient: feeRecipient,
        mint: mint,
        bondingCurve: bondingCurve,
        associatedBondingCurve: bondingCurveAta,
        associatedUser: userAta,
        user: user,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
        eventAuthority: EVENT_AUTH,
        program: program.programId,
      })
      .instruction();
    instructions.push(snipeIx);
  
    return instructions;
  };
  



  async function calcTokenAmount(connection, mint, solNumber) {
    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(PAYER),
      anchor.AnchorProvider.defaultOptions()
    );
    const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
    const bondingCurve = await getBondingCurve(mint, program.programId);
    const [bondingCurveData, mintData] = await Promise.all([
      program.account.bondingCurve.fetch(bondingCurve),
      connection.getParsedAccountInfo(mint),
    ]);
  
    //@ts-ignore
    const decimals = mintData.value?.data.parsed.info.decimals;
    const virtualTokenReserves = bondingCurveData.virtualTokenReserves.toNumber();
    const virtualSolReserves = bondingCurveData.virtualSolReserves.toNumber();
    const adjustedVirtualTokenReserves = virtualTokenReserves / 10 ** decimals;
    const adjustedVirtualSolReserves = virtualSolReserves / LAMPORTS_PER_SOL;
    const virtualTokenPrice = adjustedVirtualSolReserves / adjustedVirtualTokenReserves;
  
    const tokenAmounts = getTokenAmounts(
      adjustedVirtualSolReserves,
      adjustedVirtualTokenReserves,
      [solNumber]
    );
    return tokenAmounts[0];
  }
  

  function getTokenAmounts(initSolReserve, initTokenReserve, solList) {
    let tokenAmounts = [];
    let tokenReserve = initTokenReserve;
    let solReserve = initSolReserve;
  
    for (let i = 0; i < solList.length; i++) {
      const solAmount = solList[i];
      const tokenAmount = getAmountOut(solAmount, solReserve, tokenReserve);
      tokenAmounts.push(tokenAmount);
      tokenReserve -= tokenAmount;
      solReserve += solAmount;
    }
    console.log(`Token amounts calculated: ${tokenAmounts}`);
    return tokenAmounts;
  }
  

  function getAmountOut(amountIn, reserveIn, reserveOut) {
    const amountInWithFee = amountIn * 900;  // e.g. fee factor 970/1000 (3% fee)
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000 + amountInWithFee;
    const amountOut = numerator / denominator;
    return amountOut.toFixed(2);
  }





  async function simulateSequentialBuys(connection, mint, solAmounts) {
    // Create an Anchor provider (using your global PAYER).
    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(PAYER),
      anchor.AnchorProvider.defaultOptions()
    );
    // Create a program instance.
    const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
    // Get the bonding curve address.
    const bondingCurve = await getBondingCurve(mint, program.programId);
    // Fetch the current pool state.
    const [bondingCurveData, mintData] = await Promise.all([
      program.account.bondingCurve.fetch(bondingCurve),
      connection.getParsedAccountInfo(mint)
    ]);
    //@ts-ignore
    const decimals = mintData.value?.data.parsed.info.decimals;
  
    // Convert on-chain reserves into human-readable numbers.
    let tokenReserve = bondingCurveData.virtualTokenReserves.toNumber() / (10 ** decimals);
    let solReserve = bondingCurveData.virtualSolReserves.toNumber() / LAMPORTS_PER_SOL;
  
    const tokenAmounts = [];
    // Loop over each SOL amount (each buy) sequentially.
    for (let sol of solAmounts) {
      // Calculate token output using your fee-adjusted formula.
      // (getAmountOut returns a string, so we parse it to a number.)
      const tokenOut = parseFloat(getAmountOut(sol, solReserve, tokenReserve));
      tokenAmounts.push(tokenOut);
      // Update the simulated pool state:
      tokenReserve -= tokenOut;
      solReserve += sol;
    }
    console.log(`Simulated token amounts for sequential buys: ${tokenAmounts}`);
    return tokenAmounts;
  }































const buildMintBuyTx = async (
    program,
    signerKeypair,
    tokenMint,
    maxSolCost,
    tokenAmount
) => {
    const mint = new PublicKey(tokenMint);
    const bondingCurve = await getBondingCurve(mint, program.programId);
    const bondingCurveAta = await getAssociatedTokenAddress(
        mint,
        bondingCurve,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const globalState = new PublicKey(
        "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    ); // fixed
    const user = signerKeypair.publicKey;
    const userAta = getAssociatedTokenAddressSync(mint, user, true);
    const signerTokenAccount = getAssociatedTokenAddressSync(
        mint,
        user,
        true,
        TOKEN_PROGRAM_ID
    );

    const decimals = 6;
    const finalAmount = tokenAmount;

    console.log(`Buy token(${mint.toString()}) ${finalAmount}`);

    //creating tx;
    const tx = new Transaction();

    const userAtaInfo = await connection.getAccountInfo(userAta);
    if (!userAtaInfo) {
        tx.add(
            createAssociatedTokenAccountInstruction(
                user,
                userAta,
                user,
                mint
            )
        );
    }

    const snipeIx = await program.methods
        .buy(
            new anchor.BN(finalAmount * 10 ** decimals),
            new anchor.BN(maxSolCost * LAMPORTS_PER_SOL)
        )
        .accounts({
            global: globalState,
            feeRecipient: feeRecipient,
            mint: mint,
            bondingCurve: bondingCurve,
            associatedBondingCurve: bondingCurveAta,
            associatedUser: userAta,
            user: user,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            eventAuthority: EVENT_AUTH,
            program: program.programId,
        })
        .instruction();
    tx.add(snipeIx);

    return tx;
}
const checkSolBeforeLaunch = async (solAmounts) => {
    const solDecimals = 9;

    // Calculate total needed by all kryptic wallets (excluding minter)
    let totalKrypticSol = solAmounts.reduce((acc, val) => acc + val, 0) - solAmounts[0] + 0.1;

    // Get balances
    const krypticBalance = (await getBalance(KRYPTIC_ADDRESS)) / 10 ** solDecimals;
    const minterBalance = (await getBalance(PAYER_ADDRESS)) / 10 ** solDecimals;

    // Show helpful table
    console.log("\n🔍 Checking Wallet Balances Before Launch:");
    console.table([
        {
            Wallet: "KRYPTIC",
            Address: KRYPTIC_ADDRESS.toBase58(),
            Required_SOL: totalKrypticSol.toFixed(4),
            Current_SOL: krypticBalance.toFixed(4),
            Status: krypticBalance >= totalKrypticSol ? "✅ OK" : "❌ Not Enough"
        },
        {
            Wallet: "PRIVATE_KEY",
            Address: PAYER_ADDRESS.toBase58(),
            Required_SOL: solAmounts[0].toFixed(4),
            Current_SOL: minterBalance.toFixed(4),
            Status: minterBalance >= solAmounts[0] ? "✅ OK" : "❌ Not Enough"
        }
    ]);

    if (krypticBalance < totalKrypticSol) {
        console.log(chalk.redBright(`💥 Kryptic wallet does not have enough SOL. Needs at least ${totalKrypticSol.toFixed(4)} SOL.`));
        return false;
    }

    if (minterBalance < solAmounts[0]) {
        console.log(chalk.redBright(`💥 PRIVATE_KEY wallet does not have enough SOL. Needs at least ${solAmounts[0].toFixed(4)} SOL.`));
        return false;
    }

    return true;
};


const singleSell = async (contractAddress) => {
    try {
        console.log(chalk.redBright.bold(`🛒 Selling tokens for contract: ${contractAddress}`));

        const config = getConfig();
        const keysFile = config.keysFile;
        const wallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' }));

        if (!wallets.length) {
            console.log("❌ No wallets found in config file.");
            return;
        }

        const wallet = wallets[0]; // just like singleBuy
        const keypair = Keypair.fromSecretKey(bs58.decode(wallet.key));
        const tokenMint = new PublicKey(contractAddress);
        const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), anchor.AnchorProvider.defaultOptions());
        const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
        const tokenBalance = await getSafeTokenBalance(keypair.publicKey, tokenMint);

        if (tokenBalance <= 0) {
            console.log(chalk.yellowBright(`⚠️ No tokens to sell for wallet ${wallet.name}`));
            return;
        }

        const txSell = await buildSellTx(program, keypair, tokenMint);
        const tipAddrs = await getTipAccounts();
        const tipAccount = new PublicKey(tipAddrs[getRandomNumber(0, tipAddrs.length - 1)]);

        const instructions = [
            ...txSell.instructions,
            SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: tipAccount,
                lamports: LAMPORTS_PER_SOL * JITO_TIP,
            })
        ];

        const { blockhash } = await connection.getLatestBlockhash("finalized");

        const message = new TransactionMessage({
            payerKey: keypair.publicKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message();

        const tx = new VersionedTransaction(message);
        tx.sign([keypair]);

        const result = await sendFastBundles([tx]);

        if (result) {
            console.log(chalk.greenBright("✅ Sell successful!"));
        } else {
            console.log(chalk.redBright("❌ Sell failed."));
        }

    } catch (error) {
        console.error(chalk.redBright("❌ Error in singleSell:"), error);
    }
};
const singleBuy = async (tokenAddress) => {
    try {
      const tokenMint = new PublicKey(tokenAddress.trim());
  
      const keysFile = getConfig().keysFile;
      const wallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' }));
  
      if (!wallets.length) {
        console.log("❌ No wallets found in keys file.");
        return;
      }
  
      const wallet = wallets[0];
      const keypair = Keypair.fromSecretKey(bs58.decode(wallet.key));
      const solAmount = 0.001;
  
      const tokenAmount = await calcTokenAmount(connection, tokenMint, solAmount);
      console.log(`💸 Buying ~${tokenAmount} tokens of ${tokenMint.toBase58()} with ${solAmount} SOL from ${wallet.name} or ${wallet.address}`);
  
      const buyTx = await buildBuyTxFromInstructions(connection, keypair, tokenMint, tokenAmount, solAmount);
      const tipTx = await buildTipTx(connection, keypair);
  
      const result = await sendFastBundles([buyTx, tipTx]);
  
      if (result) {
        console.log("✅ Buy successful!");
      } else {
        console.log("❌ Buy failed.");
      }
  
    } catch (error) {
      console.error("🚨 Error in singleBuy:", error.message || error);
    }
  };

  


// Helper function to load Kryptic simulation amounts from keys.json.
const loadSimulationAmountsFromKeys = () => {
    const keysFile = 'keys.json';
    const wallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' }));
    // For each Kryptic wallet (keys.json only contains Kryptic wallets), extract the saved simulation amounts.
    const solAmounts = wallets.map(wallet => wallet.expectedSolAmount);
    const tokenAmounts = wallets.map(wallet => wallet.expectedTokenAmount);
    return { solAmounts, tokenAmounts };
  };

async function PF_NATIVE_deploySingle() {
    try {
      console.log(chalk.blueBright("🔍 Starting Native Single Deploy..."));
  
      // 1) get a new vanity mint key
      const mintPubkeyStr = await PF_getNewMintKey();
      if (!mintPubkeyStr) throw new Error("Could not fetch vanity mint key");
      const tokenMint = new PublicKey(mintPubkeyStr);
      console.log("📢 Vanity Mint Address:", tokenMint.toBase58());
  
      // 2) abort if that mint is already on-chain
      const ok = await checkPumpfunAddress(tokenMint);
      if (!ok) {
        console.log(chalk.red("❌ That vanity mint already exists. Aborting."));
        return;
      }
  
      // 3) load your simulation amounts & ensure you have SOL
      const { solAmounts, tokenAmounts } = loadSimulationAmountsFromKeys();
      console.log("💸 Using SOL:", solAmounts[0], "for", tokenAmounts[0], "tokens");
      const walletOk = await checkSolBeforeLaunch([solAmounts[0]]);
      if (!walletOk) {
        console.log(chalk.red("❌ Not enough SOL in payer wallet. Aborting."));
        return;
      }
  
      // 4) upload metadata
      const tokenUri = await testUpload();
      if (!tokenUri) throw new Error("Metadata upload failed");
      console.log("🖼️ Metadata URI:", tokenUri);
  
      // 5) init Anchor
      const provider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(PAYER),
        anchor.AnchorProvider.defaultOptions()
      );
      const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
  
      // 6) build the “create-mint” instruction
      console.log("🛠 Building mint instruction...");
      const mintIx = await buildMintIx(
        program,
        PAYER,
        tokenMint,
        process.env.TOKEN_NAME,
        process.env.TOKEN_SYMBOL,
        tokenUri
      );
  
      // 7) build the “dev buy” instruction
      console.log("🛒 Building buy instruction...");

  
      // 8) assemble versioned tx
      console.log("🧱 Assembling transaction...");
      const lookupTableAddress = new PublicKey("Ej3wFtgk3WywPnWPD3aychk38MqTdrjtqXkzbK8FpUih");
      const lookupAccount = await connection.getAddressLookupTable(lookupTableAddress);
      const lookupTables = [lookupAccount.value];
  
      const { blockhash } = await connection.getLatestBlockhash("finalized");
      const messageV0 = new TransactionMessage({
        payerKey: PAYER_ADDRESS,
        recentBlockhash: blockhash,
        instructions: [mintIx],
      }).compileToV0Message(lookupTables);
  
      const txV0 = new VersionedTransaction(messageV0);
  
      // 9) ask pump.fun backend to sign the mint-authority
      const unsignedBase58 = bs58.encode(txV0.serialize());
      console.log("🔑 Requesting mint-authority signature...");
      const partiallySigned = await PF_signCreateTx(
        unsignedBase58,
        tokenMint.toString(),
        false  // or true if you want a “free” mint creation
      );
  
      // 10) rehydrate and sign as fee-payer
      const signedBuf = bs58.decode(partiallySigned);
      const txWithMintSig = VersionedTransaction.deserialize(signedBuf);
      txWithMintSig.sign([PAYER]);  // your Keypair covers the rent + fees
  
      // 11) send & confirm
      console.log("🚀 Sending transaction...");
      const txid = await connection.sendRawTransaction(
        txWithMintSig.serialize(),
        { skipPreflight: false, preflightCommitment: "confirmed" }
      );
      console.log(chalk.cyan("⏳ Awaiting confirmation..."));
      await connection.confirmTransaction(txid, "confirmed");
  
      console.log(chalk.green("✅ Mint deployed + buy succeeded!"));
      console.log(`🔗 https://pump.fun/coin/${tokenMint.toBase58()}`);
      console.log(`🔍 Explorer: https://solscan.io/tx/${txid}`);
    } catch (err) {
      console.error(chalk.redBright("🚨 PF_NATIVE_deploySingle error:"), err);
    }
  }




const buyPumpfunTokens = async () => {
    try {
      console.log(chalk.blueBright("🔍 Starting Pumpfun Buy Process..."));
  
      let krypticWallets = [];
      if (existsSync("keys.json")) {
        krypticWallets = JSON.parse(readFileSync("keys.json", "utf-8")) || [];
        console.log(`📂 Loaded ${krypticWallets.length} wallets from keys.json`);
      }
  
      if (krypticWallets.length < WALLET_COUNT) {
        console.log(`🛠 Generating ${WALLET_COUNT - krypticWallets.length} new wallets...`);
        for (let i = krypticWallets.length; i < WALLET_COUNT; i++) {
          const newKey = Keypair.generate();
          const newPk = bs58.encode(newKey.secretKey);
          krypticWallets.push({
            name: "kryptic" + (i + 1),
            address: newKey.publicKey.toBase58(),
            key: newPk,
          });
        }
        writeFileSync("keys.json", JSON.stringify(krypticWallets, null, 2));
        console.log(`✅ Saved updated keys.json with ${WALLET_COUNT} total wallets`);
      }
  
      console.table(krypticWallets);
  
      const tokenAccount = await getKeypairFromBase58(getConfig().TOKEN_PK);
      const tokenMint = tokenAccount.publicKey;
      console.log("📢 Token Mint Address:", tokenMint.toBase58());
  
      const checkMintAddr = await checkPumpfunAddress(tokenMint);
      if (!checkMintAddr) {
        console.log("❌ Token already exists on-chain. Aborting.");
        return;
      }
  
      const { solAmounts, tokenAmounts } = loadSimulationAmountsFromKeys();
      console.log("💸 Loaded simulation amounts:");
      console.table({ solAmounts, tokenAmounts });
      const skipFunding = await askQuestion("⚠️ Skip funding step? (yes/no): ");


      
      if(skipFunding !== "yes") {
        const walletOk = await checkSolBeforeLaunch(solAmounts);
        if (!walletOk) {
            console.log(chalk.red("❌ Not enough SOL."));
            return;
        }        
    }
      const tokenName = process.env.TOKEN_NAME;
      const tokenSymbol = process.env.TOKEN_SYMBOL;
      const tokenUri = await testUpload();
      if (!tokenUri) {
        console.log("❌ Token metadata upload failed.");
        return;
      }
      console.log("🖼 Metadata URI:", tokenUri);
  
      const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(PAYER), anchor.AnchorProvider.defaultOptions());
      const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);


  
      console.log("🔗 Loaded address lookup table");
  
      const bundleTxns = [];
      let instructions = [];
  
      if (skipFunding !== "yes") {
        console.log("🚚 Dispersing SOL...");
    
        for (let i = 0; i < solAmounts.length; i++) {
            const wallet = await getKeypairFromBase58(krypticWallets[i].key);
            const lamports = parseInt((solAmounts[i] + 0.03) * LAMPORTS_PER_SOL);
            console.log(`➡️ Sending ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL to ${wallet.publicKey.toBase58()}`);
            instructions.push(SystemProgram.transfer({
                fromPubkey: KRYPTIC_ADDRESS,
                toPubkey: wallet.publicKey,
                lamports,
            }));
    
            if (i % INSTRUCTION_PER_TX === 0 || i === solAmounts.length - 1) {
                instructions.push(await getJitoTipInstruction(KRYPTIC));
                const tx = new VersionedTransaction(
                    new TransactionMessage({
                        payerKey: KRYPTIC_ADDRESS,
                        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
                        instructions,
                    }).compileToV0Message(lookupTableAccounts)
                );
                tx.sign([KRYPTIC]);
                bundleTxns.push(tx);
                console.log(`📦 Added funding tx with ${instructions.length} instructions`);
                instructions = [];
            }
        }
    
        // ✅ Retry send logic
        let success = false;
        let attempt = 0;
        const maxRetries = parseInt(process.env.MAX_RETRY || "3"); // fallback 3 if not set
    
        while (!success && attempt < maxRetries) {
            attempt++;
            console.log(chalk.yellowBright(`🚀 Attempt ${attempt} to send SOL bundle...`));
    
            const ret = await sendBundles(bundleTxns);
            if (ret) {
                console.log(chalk.greenBright("✅ SOL Disperse Success!"));
                success = true;
            } else {
                console.log(chalk.redBright(`❌ Attempt ${attempt} failed.`));
                if (attempt >= maxRetries) {
                    console.log(chalk.redBright("❌ Max retry attempts reached. Aborting SOL disperse."));
                    throw new Error("Disperse SOL Failed After Max Retries");
                } else {
                    console.log(chalk.yellow("🔄 Retrying..."));
                }
            }
        }
    
    } else {
        console.log("⏭️ Skipping funding step.");
    }
    
  
      const balances = await Promise.all([
        { publicKey: PAYER.publicKey.toBase58(), balance: await getBalance(PAYER.publicKey) },
        ...krypticWallets.map(async (w) => {
          const pk = (await getKeypairFromBase58(w.key)).publicKey;
          return { publicKey: pk.toBase58(), balance: await getBalance(pk) };
        }),
      ]);
      console.log("💰 Wallet Balances:");
      console.table(balances);
  
      console.log("🛠 Creating mint instruction...");
      const mintIx = await buildMintIx(program, PAYER, tokenMint, tokenName, tokenSymbol, tokenUri);
  
      console.log("🛒 Building dev buy...");
      const txBuyDev = await buildMintBuyTx(program, PAYER, tokenMint, solAmounts[0], tokenAmounts[0]);
      let firstSigners = [PAYER, tokenAccount];
      instructions = [mintIx, ...txBuyDev.instructions];
  
      for (let i = 1; i < 3; i++) {
        if (!tokenAmounts[i] || !solAmounts[i]) {
          console.warn(`⚠️ Missing tokenAmount or solAmount at index ${i}`);
          continue;
        }
  
        const walletInfo = krypticWallets[i - 1];
        console.log(`🔑 Kryptic Wallet ${walletInfo.name} buy...`);
  
        const payer = await getKeypairFromBase58(walletInfo.key);
        const txBuy = await buildBuyInstruction(program, payer, tokenMint, tokenAmounts[i], solAmounts[i]);
  
        if (!Array.isArray(txBuy) || txBuy.length === 0) {
          console.error(`❌ Invalid buy instructions at index ${i}`);
          continue;
        }
  
        console.log(`✅ Appending ${txBuy.length} buy instructions`);
        instructions.push(...txBuy);
        firstSigners.push(payer);
      }
  
      instructions.push(await getJitoTipInstruction(PAYER));
  
      const launchTx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: PAYER_ADDRESS,
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
          instructions,
        }).compileToV0Message(lookupTableAccounts)
      );
      launchTx.sign(firstSigners);
      bundleTxns.push(launchTx);
      console.log("🚀 Added mint + dev buy + early Kryptic buys tx");
  
      instructions = [];
      const signers = [];
  
      for (let i = 3; i < tokenAmounts.length; i++) {
        const tokenAmount = tokenAmounts[i];
        const solAmount = solAmounts[i];
        const krypticKeypair = await getKeypairFromBase58(krypticWallets[i - 1].key);
        const subProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(krypticKeypair), anchor.AnchorProvider.defaultOptions());
        const subProgram = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, subProvider);
        const txBuy = await buildBuyInstruction(subProgram, krypticKeypair, tokenMint, tokenAmount, solAmount);
  
        if (!Array.isArray(txBuy) || txBuy.length === 0) {
          console.warn(`⚠️ Skipping buy at index ${i}, no valid instructions.`);
          continue;
        }
  
        instructions.push(...txBuy);
        signers.push(krypticKeypair);
  
        if ((i - 2) % INSTRUCTION_PER_TX === 0 || i === tokenAmounts.length - 1) {
          const tx = new VersionedTransaction(
            new TransactionMessage({
              payerKey: krypticKeypair.publicKey,
              recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
              instructions,
            }).compileToV0Message(lookupTableAccounts)
          );
          tx.sign(signers);
          bundleTxns.push(tx);
          console.log(`📦 Added buy batch tx (${i}), instructions: ${instructions.length}`);
          instructions = [];
          signers.length = 0;
        }
      }
  
      console.log("📦 Final Bundle Summary:");
      bundleTxns.forEach((tx, i) => {
        console.log(`  Tx ${i + 1}: ${tx.message.instructions.length} instructions`);
      });
  
  
      // UNCOMMENT to send
      const launchResult = await sendBundles(bundleTxns);
      if (launchResult) {
        console.log(chalk.greenBright(`✅ Custom Token Launch Successful!`));
        console.log(`🔗 https://pump.fun/coin/${tokenMint.toBase58()}`);
        CONFIG_updateLastUsedToken(tokenMint.toBase58()); 

        } else {
            console.log(chalk.redBright("❌ Custom Token Launch Failed."));
        }

  
    } catch (error) {
      console.error(chalk.red("🚨 Critical Error in buyPumpfunTokens:"), error);
    }
  };
  

const checkSol = async () => {
    let walletInfo = [];

    // Add ParentKryptic balance
    walletInfo.push({ wallet: 'ParentKryptic', solAmount: await connection.getBalance(KRYPTIC_ADDRESS) / LAMPORTS_PER_SOL });

    // Add Minter balance
    walletInfo.push({ wallet: 'Minter', solAmount: await connection.getBalance(PAYER_ADDRESS) / LAMPORTS_PER_SOL });

    // Load keys from keys.json
    const keysFile = getConfig().keysFile;
    let krypticWallets = [];
    if (existsSync(keysFile)) {
        krypticWallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' })) || [];
    }

    // Add balances for each Kryptic wallet
    for (const wallet of krypticWallets) {
        const keypair = Keypair.fromSecretKey(bs58.decode(wallet.key));
        const solAmount = await connection.getBalance(keypair.publicKey) / LAMPORTS_PER_SOL;
        walletInfo.push({ wallet: wallet.name, address: wallet.address, solAmount: solAmount });
    }

    console.table(walletInfo);
};

const PF_NATIVE_deployBundle = async () => {
    try {
        console.log(chalk.blueBright("🔍 Starting Native Bundle Deploy..."));

        // 1) get vanity mint
        const mintPubkeyStr = await PF_getNewMintKey();
        if (!mintPubkeyStr) throw new Error("Could not fetch vanity mint key");
        const tokenMint = new PublicKey(mintPubkeyStr);
        console.log("📢 Vanity Mint Address:", tokenMint.toBase58());
        CONFIG_updateLastUsedToken(tokenMint.toBase58()); 

        // 2) check mint not already exists
        const exists = await checkPumpfunAddress(tokenMint);
        if (!exists) {
            console.log(chalk.red("❌ Mint already exists. Aborting."));
            return;
        }

        // 3) prepare wallets
        let krypticWallets = [];
        if (existsSync('keys.json')) {
            krypticWallets = JSON.parse(readFileSync('keys.json', 'utf-8')) || [];
        }

        if (krypticWallets.length < WALLET_COUNT) {
            for (let i = krypticWallets.length; i < WALLET_COUNT; i++) {
                const newKey = Keypair.generate();
                krypticWallets.push({
                    name: "kryptic" + (i + 1),
                    address: newKey.publicKey.toBase58(),
                    key: bs58.encode(newKey.secretKey),
                });
            }
            writeFileSync('keys.json', JSON.stringify(krypticWallets, null, 2));
            console.log(`✅ Saved updated keys.json`);
        }

        const { solAmounts, tokenAmounts } = loadSimulationAmountsFromKeys();
        const skipFunding = await askQuestion("⚠️ Skip funding step? (yes/no): ");

        if(skipFunding !== "yes") {
            const walletOk = await checkSolBeforeLaunch(solAmounts);
            if (!walletOk) {
                console.log(chalk.red("❌ Not enough SOL."));
                return;
            }        
        }


        const tokenUri = await testUpload();
        if (!tokenUri) throw new Error("Metadata upload failed");

        const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(PAYER), anchor.AnchorProvider.defaultOptions());
        const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
        const lookupTableAddress = new PublicKey("Ej3wFtgk3WywPnWPD3aychk38MqTdrjtqXkzbK8FpUih");
        const lookupTableAccount = await connection.getAddressLookupTable(lookupTableAddress);
        const lookupTables = [lookupTableAccount.value];

        const bundleTxns = [];
        let instructions = [];


        // 4) Disperse SOL to wallets if needed
        if (skipFunding !== "yes") {
            console.log("🚚 Dispersing SOL...");

            for (let i = 0; i < solAmounts.length; i++) {
                const wallet = await getKeypairFromBase58(krypticWallets[i].key);
                const lamports = parseInt((solAmounts[i] + 0.03) * LAMPORTS_PER_SOL);
                instructions.push(SystemProgram.transfer({
                    fromPubkey: KRYPTIC_ADDRESS,
                    toPubkey: wallet.publicKey,
                    lamports,
                }));

                if (i % INSTRUCTION_PER_TX === 0 || i === solAmounts.length - 1) {
                    instructions.push(await getJitoTipInstruction(KRYPTIC));
                    const versionedTx = new VersionedTransaction(
                        new TransactionMessage({
                            payerKey: KRYPTIC_ADDRESS,
                            recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
                            instructions,
                        }).compileToV0Message(lookupTables)
                    );
                    versionedTx.sign([KRYPTIC]);
                    bundleTxns.push(versionedTx);
                    instructions = [];
                }
            }

            let success = false;
            let attempt = 0;
            const maxRetries = parseInt(process.env.MAX_RETRY || "3");

            while (!success && attempt < maxRetries) {
                attempt++;
                console.log(chalk.yellowBright(`🚀 Attempt ${attempt} to send funding bundle...`));
                const ret = await sendBundles(bundleTxns);
                if (ret) {
                    console.log(chalk.greenBright("✅ SOL Dispersed Successfully!"));
                    success = true;
                } else {
                    console.log(chalk.redBright(`❌ Attempt ${attempt} failed.`));
                    if (attempt >= maxRetries) {
                        console.log(chalk.redBright("❌ Max retry attempts reached. Aborting."));
                        throw new Error("Disperse SOL Failed After Max Retries");
                    } else {
                        console.log(chalk.yellow("🔄 Retrying..."));
                    }
                }
            }
        } else {
            console.log("⏭️ Skipping funding step.");
        }

        // 5) Build Mint + Dev Buy + Early Buys
        console.log("🛠 Building mint + early buys...");
        const mintIx = await buildMintIx(program, PAYER, tokenMint, process.env.TOKEN_NAME, process.env.TOKEN_SYMBOL, tokenUri);
        const txBuyDev = await buildMintBuyTx(program, PAYER, tokenMint, solAmounts[0], tokenAmounts[0]);
        let mintInstructions = [mintIx, ...txBuyDev.instructions];
        let mintSigners = [PAYER];

        for (let i = 1; i < 3; i++) {
            const payer = await getKeypairFromBase58(krypticWallets[i - 1].key);
            const txBuy = await buildBuyInstruction(program, payer, tokenMint, tokenAmounts[i], solAmounts[i]);
            mintInstructions.push(...txBuy);
            mintSigners.push(payer);
        }

        mintInstructions.push(await getJitoTipInstruction(PAYER));

        const { blockhash } = await connection.getLatestBlockhash("finalized");
        const messageV0 = new TransactionMessage({
            payerKey: PAYER_ADDRESS,
            recentBlockhash: blockhash,
            instructions: mintInstructions,
        }).compileToV0Message(lookupTables);

        const txV0 = new VersionedTransaction(messageV0);

        // 6) Request mint authority sign
        console.log("🔑 Requesting mint-authority signature...");
        const unsignedBase58 = bs58.encode(txV0.serialize());
        const partiallySigned = await PF_signCreateTx(unsignedBase58, tokenMint.toString(), false);
        const signedBuf = bs58.decode(partiallySigned);
        const txWithMintSig = VersionedTransaction.deserialize(signedBuf);
        txWithMintSig.sign(mintSigners);

        bundleTxns.push(txWithMintSig);

        // 7) Build later buys
        console.log("🛒 Building later buy transactions...");
        let laterInstructions = [];
        let laterSigners = [];

        for (let i = 3; i < tokenAmounts.length; i++) {
            const payer = await getKeypairFromBase58(krypticWallets[i - 1].key);
            const subProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), anchor.AnchorProvider.defaultOptions());
            const subProgram = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, subProvider);

            const txBuy = await buildBuyInstruction(subProgram, payer, tokenMint, tokenAmounts[i], solAmounts[i]);
            laterInstructions.push(...txBuy);
            laterSigners.push(payer);

            if ((i - 2) % INSTRUCTION_PER_TX === 0 || i === tokenAmounts.length - 1) {
                const blockhashLater = (await connection.getLatestBlockhash()).blockhash;
                const messageLater = new TransactionMessage({
                    payerKey: payer.publicKey,
                    recentBlockhash: blockhashLater,
                    instructions: laterInstructions,
                }).compileToV0Message(lookupTables);

                const laterTx = new VersionedTransaction(messageLater);
                laterTx.sign(laterSigners);

                bundleTxns.push(laterTx);

                laterInstructions = [];
                laterSigners = [];
            }
        }

        // 8) Send full JITO Bundle
        console.log(chalk.blueBright(`🚀 Sending ${bundleTxns.length} transactions as a JITO bundle...`));

        let retry = 0;
        const maxRetries = parseInt(process.env.MAX_RETRY || "3");
        
        while (retry < maxRetries) {
            const launchResult = await sendBundles(bundleTxns);
        
            if (launchResult) {
                console.log(chalk.greenBright(`✅ Native Token Launch Successful!`));
                console.log(`🔗 https://pump.fun/coin/${tokenMint.toBase58()}`);
                CONFIG_updateLastUsedToken(tokenMint.toBase58()); 

                break;
            } else {
                retry++;
                console.log(chalk.redBright(`❌ Launch attempt ${retry} failed.`));
                
                if (retry >= maxRetries) {
                    console.log(chalk.bgRedBright("🚫 Max retry attempts reached. Aborting launch."));
                    break;
                }
        
                console.log(chalk.yellowBright(`🔄 Retrying launch... (Attempt ${retry + 1}/${maxRetries})`));
                await new Promise(resolve => setTimeout(resolve, 1000 * retry));
            }
        }
        

    } catch (err) {
        
        console.error(chalk.redBright("🚨 PF_NATIVE_deployBundle Error:"), err);
    }
};





  
const buyDelayPumpfunTokens = async () => {
    try {
      // ── Load or create the buy wallets (stored in keys.json) ─────────────────────────────
      let krypticWallets = [];
      if (existsSync("keys.json")) {
        krypticWallets = JSON.parse(readFileSync("keys.json", { encoding: "utf-8" })) || [];
      }
      if (krypticWallets.length < WALLET_COUNT) {
        for (let i = krypticWallets.length; i < WALLET_COUNT; i++) {
          const newKey = Keypair.generate();
          const newPk = bs58.encode(newKey.secretKey);
          const newAddr = newKey.publicKey.toString();
          const index = i + 1;
          // Make sure to add an expectedSolAmount value for each wallet
          krypticWallets.push({
            name: "kryptic" + index,
            address: newAddr,
            key: newPk,
            expectedSolAmount: 0, // set a default or update manually
          });
        }
        writeFileSync("keys.json", JSON.stringify(krypticWallets, null, 2));
      }
      console.table(krypticWallets);
  
      // ── Load or create the middle wallets (stored in middleKeys.json) ─────────────────────────────
      let middleWallets = [];
      if (existsSync("middleKeys.json")) {
        middleWallets = JSON.parse(readFileSync("middleKeys.json", { encoding: "utf-8" })) || [];
      }
      if (middleWallets.length < WALLET_COUNT) {
        for (let i = middleWallets.length; i < WALLET_COUNT; i++) {
          const newKey = Keypair.generate();
          const newPk = bs58.encode(newKey.secretKey);
          const newAddr = newKey.publicKey.toString();
          const index = i + 1;
          middleWallets.push({
            name: "middle" + index,
            address: newAddr,
            key: newPk,
          });
        }
        writeFileSync("middleKeys.json", JSON.stringify(middleWallets, null, 2));
      }
      console.table(middleWallets);
  
      // ── Retrieve token account and mint address ─────────────────────────────
      let tokenMint;
      let tokenAccount;
      
      if (GLOBAL_useNativeToken()) {
        console.log(chalk.magentaBright("🎯 Native Mode Detected — Fetching Vanity Mint Key..."));
      
        const mintPubkeyStr = await PF_getNewMintKey();
        if (!mintPubkeyStr) throw new Error("Could not fetch vanity mint key");
      
        tokenMint = new PublicKey(mintPubkeyStr);
        console.log(chalk.cyan("📢 Vanity Token Mint Address:"), tokenMint.toString());
      
      } else {
        tokenAccount = await getKeypairFromBase58(getConfig().TOKEN_PK);
        tokenMint = tokenAccount.publicKey;
        console.log(chalk.cyan("📢 TokenMintAddress:"), tokenMint.toString());
      }
      
  
      const checkMintAddr = await checkPumpfunAddress(tokenMint);
      if (!checkMintAddr) return;
  
      // ── Load simulation amounts for create/dev buy transactions ─────────────────────────────
      const { solAmounts, tokenAmounts } = loadSimulationAmountsFromKeys();
      const checkWallet = checkSolBeforeLaunch(solAmounts);
      if (!checkWallet) return;
  
      const tokenUri = await testUpload();
  
      // ── Create Anchor provider and program ─────────────────────────────
      const provider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(PAYER),
        anchor.AnchorProvider.defaultOptions()
      );
      const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
  
      // ── Get lookup table account for VersionedTransactions ─────────────────────────────
      const firstAddressLookup = new PublicKey("Ej3wFtgk3WywPnWPD3aychk38MqTdrjtqXkzbK8FpUih");
      const lookupTableAccount = await connection.getAddressLookupTable(firstAddressLookup);
      const lookupTableAccounts = [lookupTableAccount.value];
  
      // ── Step 1: Funding (kryptic) Wallet -> Middle Wallets (bundle transfer) ─────────────────────────────
      console.log(chalk.blue("➡️ Bundling transfer from funding wallet to middle wallets using expectedSolAmount from keys.json..."));
      const fundingToMiddleTxns = [];
      let fundingToMiddleInstructions = [];
      for (let i = 0; i < WALLET_COUNT; i++) {
        const expectedSol = Number(krypticWallets[i].expectedSolAmount);
        if (isNaN(expectedSol)) {
          throw new Error(`Invalid expectedSolAmount for ${krypticWallets[i].name}: ${krypticWallets[i].expectedSolAmount}`);
        }
        fundingToMiddleInstructions.push(
          SystemProgram.transfer({
            fromPubkey: KRYPTIC_ADDRESS,
            toPubkey: (await getKeypairFromBase58(middleWallets[i].key)).publicKey,
            lamports: Math.floor(expectedSol * LAMPORTS_PER_SOL),
          })
        );
        if ((i + 1) % INSTRUCTION_PER_TX === 0 || i === WALLET_COUNT - 1) {
          fundingToMiddleInstructions.push(await getJitoTipInstruction(KRYPTIC));
          const { blockhash } = await connection.getLatestBlockhash();
          const tx = new VersionedTransaction(
            new TransactionMessage({
              payerKey: KRYPTIC_ADDRESS,
              recentBlockhash: blockhash,
              instructions: fundingToMiddleInstructions,
            }).compileToV0Message(lookupTableAccounts)
          );
          tx.sign([KRYPTIC]);
          fundingToMiddleTxns.push(tx);
          fundingToMiddleInstructions = [];
        }
      }
      const retFundingToMiddle = await sendBundles(fundingToMiddleTxns);
      if (!retFundingToMiddle) throw new Error("Funding -> Middle bundle submission failed");
      console.log(chalk.green("✔️ SOL sent from funding wallet to middle wallets"));
  
      // ── Step 2: Middle Wallets -> Buy Wallets (individual transfers, no bundling) ─────────────────────────────
      console.log(chalk.blue("➡️ Sending SOL from middle wallets to buy wallets individually..."));
      const transactionPromises = [];
      const maxRetries = 3;
      const feeForTransfer = 5000;      // Estimated fee for transfer transaction
      const leave = feeForTransfer;      // Fee reserve
  
      const sendTransactionWithRetry = async (versionedTransaction, walletIndex, txType, attempt = 0) => {
        try {
          const simulation = await connection.simulateTransaction(versionedTransaction);
          if (simulation.value.err) {
            throw new Error(`Simulation error: ${JSON.stringify(simulation.value.err)}`);
          }
          const txId = await connection.sendTransaction(versionedTransaction);
          await connection.confirmTransaction(txId);
          console.log(`✅ ${txType} transaction sent and confirmed for wallet ${middleWallets[walletIndex].name}: ${txId}`);
        } catch (error) {
          if (attempt < maxRetries) {
            console.warn(
              `⚠️ Error sending ${txType} transaction for wallet ${middleWallets[walletIndex].name}, attempt ${attempt + 1}: ${error.message}`
            );
            await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
            return sendTransactionWithRetry(versionedTransaction, walletIndex, txType, attempt + 1);
          } else {
            console.error(`❌ ${txType} transaction failed for wallet ${middleWallets[walletIndex].name} after ${maxRetries} attempts:`, error);
          }
        }
      };
  
      for (let i = 0; i < WALLET_COUNT; i++) {
        const middleWalletKeypair = await getKeypairFromBase58(middleWallets[i].key);
        const buyWalletKeypair = await getKeypairFromBase58(krypticWallets[i].key);
        const middleAddress = typeof middleWallets[i].address === "string"
          ? new PublicKey(middleWallets[i].address)
          : middleWallets[i].address;
        const balance = await connection.getBalance(middleAddress);
        const lamportsToSend = balance - leave;
        console.log(`${lamportsToSend} lamports will be sent from ${middleWallets[i].name}`);
        if (lamportsToSend <= 0) {
          console.log(`Not enough balance in ${middleWallets[i].name} to transfer.`);
          continue;
        }
        const transferInstruction = SystemProgram.transfer({
          fromPubkey: middleWalletKeypair.publicKey,
          toPubkey: buyWalletKeypair.publicKey,
          lamports: lamportsToSend,
        });
        const { blockhash: transferBlockhash } = await connection.getLatestBlockhash();
        const transferTx = new VersionedTransaction(
          new TransactionMessage({
            payerKey: middleWalletKeypair.publicKey,
            recentBlockhash: transferBlockhash,
            instructions: [transferInstruction],
          }).compileToV0Message(lookupTableAccounts)
        );
        transferTx.sign([middleWalletKeypair]);
        const transferPromise = sendTransactionWithRetry(transferTx, i, "Transfer");
        transactionPromises.push(transferPromise);
      }
      await Promise.all(transactionPromises);
      console.log(chalk.green("✔️ SOL transferred from middle wallets to buy wallets individually."));






  
      // ── Step 3: Create and Dev Buy Transactions (bundled process) ─────────────────────────────
      console.log(chalk.blue("➡️ Submitting Create and Dev Buy Transactions..."));
      const createTxns = [];
      const createInstructions = [];
      const mintIx = await buildMintIx(
        program,
        PAYER,
        tokenMint,
        process.env.TOKEN_NAME,
        process.env.TOKEN_SYMBOL,
        tokenUri
      );
      const txBuyDev = await buildMintBuyTx(
        program,
        PAYER,
        tokenMint,
        solAmounts[0],
        tokenAmounts[0]

      );
      createInstructions.push(mintIx, ...txBuyDev.instructions, await getJitoTipInstruction(PAYER));
      const { blockhash: blockhashCreate } = await connection.getLatestBlockhash();
      const createTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: PAYER_ADDRESS,
          recentBlockhash: blockhashCreate,
          instructions: createInstructions,
        }).compileToV0Message(lookupTableAccounts)
      );
      if (GLOBAL_useNativeToken()) {
        console.log("🔑 Requesting mint-authority signature for Native Deploy...");
        const unsignedBase58 = bs58.encode(createTransaction.serialize());
        const partiallySigned = await PF_signCreateTx(unsignedBase58, tokenMint.toString(), false);
      
        const signedBuf = bs58.decode(partiallySigned);
        const txWithMintSig = VersionedTransaction.deserialize(signedBuf);
        txWithMintSig.sign([PAYER]);
        
        createTxns.push(txWithMintSig);
      
      } else {
        createTransaction.sign([PAYER, tokenAccount]);
        createTxns.push(createTransaction);
      }
      
      const retCreate = await sendBundles(createTxns);
      if (!retCreate) throw new Error("Create and Dev Buy bundle submission failed");
      CONFIG_updateLastUsedToken(tokenMint.toBase58()); 

      console.log(chalk.green("✔️ Create and Dev Buy Transactions Submitted"));
  
      // ── Wait for user input before proceeding with buys ─────────────────────────────
      const waitForUser = async () => {
        console.log("🚀 Press Enter to start buying tokens...");
        return new Promise((resolve) => {
          process.stdin.once("data", () => {
            resolve();
          });
        });
      };
      await waitForUser();









  
      // ── Step 4: Individual Buy Transactions using buy wallet amounts (on-chain calculation, no API) ─────────────────────────────
      console.log(chalk.blue("➡️ Sending Individual Buy Transactions Internally..."));
  
      // Build an array of trade amounts (each wallet's expectedSolAmount minus a buffer, e.g. 0.05 SOL).
      const tradeAmounts = krypticWallets.map(wallet =>
        parseFloat((Number(wallet.expectedSolAmount) - 0.05).toFixed(3))
      );
  
      // Simulate sequential buys to account for pool changes (returns token outputs sequentially).
      const simulatedTokenOutputs = await simulateSequentialBuys(
        connection,
        tokenMint,
        tradeAmounts
      );
  
      // Build and send all buy transactions concurrently.
      const pendingBuyPromises = [];
      let buyTxCounter = 0;
      for (let i = 0; i < WALLET_COUNT; i++) {
        try {
          const wallet = krypticWallets[i];
          const walletKeypair = await getKeypairFromBase58(wallet.key);
          if (!walletKeypair || !walletKeypair.publicKey) {
            throw new Error(`Invalid keypair for wallet ${wallet.name}`);
          }
          const solAmountStr = wallet.expectedSolAmount.toFixed(3);
          const tradeAmount = tradeAmounts[i];
          console.log(`🟣 Building trade transaction for ${wallet.name} with ${solAmountStr} SOL (trade amount: ${tradeAmount} SOL)`);
  
          // Use the simulated token output for this wallet.
          const tokenAmount = simulatedTokenOutputs[i];
          console.log(`Calculated token amount for ${wallet.name}: ${tokenAmount}`);
  
          // Build the buy transaction (using on-chain logic, no API).
          const buyTx = await buildBuyTxFromInstructions(
            connection,
            walletKeypair,
            tokenMint,         // token mint as PublicKey
            tokenAmount,       // expected token output
            tradeAmount        // SOL being spent
          );
  
          // Build the tip transaction.
          const tipTx = await buildTipTx(connection, walletKeypair);
  
          // Send the bundled transactions.
          pendingBuyPromises.push(sendFastBundles([buyTx, tipTx]));
          buyTxCounter++;
         
           
            await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error(`❌ Buy transaction failed for ${krypticWallets[i].name || "Unknown wallet"}:`, error);
        }
      }
      const buyResults = await Promise.all(pendingBuyPromises);
      console.log(chalk.green("✅ All individual buy transactions processed."), buyResults);
  
    } catch (error) {
      console.error("Error:", error);
    }
  };
  





const buildSellTx = async (program, signerKeypair, tokenMint) => {
    const mint = new PublicKey(tokenMint);
    const bondingCurve = await getBondingCurve(mint, program.programId);
    const bondingCurveAta = await getAssociatedTokenAddress(
        mint,
        bondingCurve,
        true
    );
    const decimals = 6;
    const globalState = new PublicKey(
        "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    ); // fixed
    const user = signerKeypair.publicKey;
    const userAta = getAssociatedTokenAddressSync(mint, user, true);
    // console.log("userAta ====>", userAta);
    const signerTokenAccount = getAssociatedTokenAddressSync(mint, user, true);
    // const decimals = 6;
    tokenBalance = await getSafeTokenBalance(
        signerKeypair.publicKey.toBase58(),
        mint.toBase58()
    );
    const tx = new Transaction();
    const snipeIx = await program.methods
        .sell(new anchor.BN(tokenBalance * 10 ** decimals), new anchor.BN(0 * LAMPORTS_PER_SOL))
        .accounts({
            global: globalState,
            feeRecipient: feeRecipient,
            mint: mint,
            bondingCurve: bondingCurve,
            associatedBondingCurve: bondingCurveAta,
            associatedUser: userAta,
            user: user,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            eventAuthority: EVENT_AUTH,
            program: program.programId,
        })
        .instruction();
    tx.add(snipeIx);

    return tx;
}





const buildPercentSellTx = async (program, signerKeypair, tokenMint, tokensToSell) => {
    const mint = new PublicKey(tokenMint);
    const bondingCurve = await getBondingCurve(mint, program.programId);
    const bondingCurveAta = await getAssociatedTokenAddress(
        mint,
        bondingCurve,
        true
    );
    const decimals = 6;
    const globalState = new PublicKey(
        "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    ); // fixed
    const user = signerKeypair.publicKey;
    const userAta = getAssociatedTokenAddressSync(mint, user, true);

    // Use `tokensToSell` directly, which is already calculated
    const tx = new Transaction();
    const snipeIx = await program.methods
        .sell(
            new anchor.BN(tokensToSell * 10 ** decimals), // Use tokensToSell
            new anchor.BN(0 * LAMPORTS_PER_SOL)
        )
        .accounts({
            global: globalState,
            feeRecipient: feeRecipient,
            mint: mint,
            bondingCurve: bondingCurve,
            associatedBondingCurve: bondingCurveAta,
            associatedUser: userAta,
            user: user,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            eventAuthority: EVENT_AUTH,
            program: program.programId,
        })
        .instruction();
    tx.add(snipeIx);

    return tx;
};















const sellPercentageOfTokens = async (highPercentage, lowPercentage) => {
    try {
        let tokenMint;
        if (GLOBAL_useNativeToken()) {
            const lastUsed = CONFIG_lastUsedToken();
            if (!lastUsed) {
                console.log("❌ No last native token found.");
                process.exit(1);
            }
            tokenMint = new PublicKey(lastUsed);
        } else {
            const tokenAccount = await getKeypairFromBase58(getConfig().TOKEN_PK);
            tokenMint = tokenAccount.publicKey;
        }
        const provider = new anchor.AnchorProvider(
            connection,
            new anchor.Wallet(PAYER),
            anchor.AnchorProvider.defaultOptions()
        );
        const tipAddrs = await getTipAccounts();
        const tipAccount = new PublicKey(tipAddrs[getRandomNumber(0, tipAddrs.length - 1)]);
        const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
        const keysFile = getConfig().keysFile;
        let krypticWallets = [];
        if (existsSync(keysFile))
            krypticWallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' })) || [];
        krypticWallets.push({ 'name': 'Minter', 'address': PAYER_ADDRESS.toString(), 'key': process.env.MINTER_KEY });

        const pendingBundlePromises = [];
        let transactionCounter = 0;

        const sendTransaction = async (tx, walletName) => {
            try {
                const ret = await sendFastBundles([tx]);
                console.log(`Transaction successful for ${walletName}`);
                return ret;
            } catch (error) {
                console.error(`Transaction failed for ${walletName}:`, error);
                return null;
            }
        };

        for (let i = 0; i < krypticWallets.length; i++) {
            const privateKey = krypticWallets[i]['key'];
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
            const tokenBalance = await getSafeTokenBalance(keypair.publicKey, tokenMint);
            const recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;

            if (tokenBalance > 0) {
                // Calculate a random percentage within the range and determine tokens to sell
                const percentageToSell = Math.random() * (highPercentage - lowPercentage) + lowPercentage;
                const tokensToSell = Math.floor((percentageToSell / 100) * tokenBalance);

                console.log(`${krypticWallets[i]['name']} has ${tokenBalance} tokens and will attempt to sell ${tokensToSell} (${percentageToSell.toFixed(2)}%)`);

                if (tokensToSell > 0 && tokensToSell <= tokenBalance) {
                    let txSell = await buildPercentSellTx(program, keypair, tokenMint, tokensToSell);

                    let newInnerTransactions = [...txSell.instructions];
                    newInnerTransactions.push(
                        SystemProgram.transfer({
                            fromPubkey: keypair.publicKey,
                            toPubkey: tipAccount,
                            lamports: LAMPORTS_PER_SOL * JITO_TIP,
                        })
                    );

                    const transactionMessage = new TransactionMessage({
                        payerKey: keypair.publicKey,
                        instructions: newInnerTransactions,
                        recentBlockhash,
                    });

                    const tx = new VersionedTransaction(transactionMessage.compileToV0Message());
                    tx.sign([keypair]);

                    const transactionPromise = sendTransaction(tx, krypticWallets[i]['name']);
                    pendingBundlePromises.push(transactionPromise);

                    transactionCounter++;
                    if (transactionCounter % 5 === 0) {
                        console.log(chalk.yellowBright(`Pausing for 300ms after ${transactionCounter} transactions...`));
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                } else {
                    console.log(`${krypticWallets[i]['name']} has no tokens to sell within the specified range.`);
                }
            } else {
                console.log(`${krypticWallets[i]['name']} has no tokens to sell.`);
            }
        }

        const results = await Promise.all(pendingBundlePromises);

        console.log(chalk.blueBright("BundleResponse: "), results);

        if (results.length > 0) {
            let succeed = false;
            for (let k = 0; k < results.length; k++) {
                if (results[k]) {
                    succeed = true;
                    break;
                }
            }
            if (!succeed) {
                console.log("Selling Error");
            }
        }
    } catch (error) {
        console.log("error:", error);
    }
};





const sellAllTokens = async () => {
    try {

        let tokenMint;
        if (GLOBAL_useNativeToken()) {
            const lastUsed = CONFIG_lastUsedToken();
            if (!lastUsed) {
                console.log("❌ No last native token found.");
                process.exit(1);
            }
            tokenMint = new PublicKey(lastUsed);
        } else {
            const tokenAccount = await getKeypairFromBase58(getConfig().TOKEN_PK);
            tokenMint = tokenAccount.publicKey;
        }
        const provider = new anchor.AnchorProvider(
            connection,
            new anchor.Wallet(PAYER),
            anchor.AnchorProvider.defaultOptions()
        );
        const tipAddrs = await getTipAccounts();
        const tipAccount = new PublicKey(tipAddrs[getRandomNumber(0, tipAddrs.length - 1)]);
        const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
        const keysFile = getConfig().keysFile;
        let krypticWallets = [];
        if (existsSync(keysFile))
            krypticWallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' })) || [];
        krypticWallets.push({'name':'Minter','address':PAYER_ADDRESS.toString(),'key':process.env.MINTER_KEY});


        const pendingBundlePromises = [];
        let transactionCounter = 0;  // Counter to track the number of transactions

        // Direct function to send transaction without retry
        const sendTransaction = async (tx, walletName) => {
            try {
                const ret = await sendFastBundles([tx]);
                console.log(`Transaction successful for ${walletName}`);
                return ret;
            } catch (error) {
                console.error(`Transaction failed for ${walletName}:`, error);
                return null;
            }
        };

        for (let i = 0; i < krypticWallets.length; i++) {
            const privateKey = krypticWallets[i]['key'];
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
            const tokenBalance = await getSafeTokenBalance(keypair.publicKey, tokenMint);
            const recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;

            if (tokenBalance > 0) {
                let txSell = await buildSellTx(program, keypair, tokenMint);

                let newInnerTransactions = [...txSell.instructions];
                newInnerTransactions.push(
                    SystemProgram.transfer({
                        fromPubkey: keypair.publicKey,
                        toPubkey: tipAccount,
                        lamports: LAMPORTS_PER_SOL * JITO_TIP,
                    })
                );

               
                const transactionMessage = new TransactionMessage({
                    payerKey: keypair.publicKey,
                    instructions: newInnerTransactions,
                    recentBlockhash,
                });

                const tx = new VersionedTransaction(transactionMessage.compileToV0Message());
                tx.sign([keypair]);

                // Push the sendTransaction promise to the array
                const transactionPromise = sendTransaction(tx, krypticWallets[i]['name']);
                pendingBundlePromises.push(transactionPromise);

                // Increase transaction counter and introduce delay after every 7 transactions
                transactionCounter++;
                if (transactionCounter % 5 === 0) {
                    console.log(`Pausing for 300ms after ${transactionCounter} transactions...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));  // Delay for 300ms
                }
            }
        }

        // Execute all transactions concurrently
        const results = await Promise.all(pendingBundlePromises);

        console.log("pendingBundleResponse: ", results);

        if (results.length > 0) {
            let succeed = false;
            for (let k = 0; k < results.length; k++) {
                if (results[k]) {
                    succeed = true;
                    break;
                }
            }
            if (!succeed) {
                console.log("Selling Error");
            }
        }

    } catch (error) {
        console.log("error:", error);
    }
};


const sellTokens = async (walletNumbers) => {
    try {
        let tokenMint;
        if (GLOBAL_useNativeToken()) {
            const lastUsed = CONFIG_lastUsedToken();
            if (!lastUsed) {
                console.log("❌ No last native token found.");
                process.exit(1);
            }
            tokenMint = new PublicKey(lastUsed);
        } else {
            const tokenAccount = await getKeypairFromBase58(getConfig().TOKEN_PK);
            tokenMint = tokenAccount.publicKey;
        }
        const provider = new anchor.AnchorProvider(
            connection,
            new anchor.Wallet(PAYER),
            anchor.AnchorProvider.defaultOptions()
        );
        const tipAddrs = await getTipAccounts();
        const tipAccount = new PublicKey(tipAddrs[getRandomNumber(0, tipAddrs.length - 1)]);
        const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);

        const bundleTxns = [];
        let pendingBundlePromises = [];
        let krypticWallets = [];
        krypticWallets.push({ name: 'Minter', address: PAYER_ADDRESS.toString(), key: process.env.MINTER_KEY });
        const keysFile = getConfig().keysFile;
        if (existsSync(keysFile)) {
            krypticWallets = [...krypticWallets, ...JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' }))];
        }

        const maxRetries = 5; // Maximum number of retries
        const retryDelay = 1000; // Delay in milliseconds between retries

        const sendTransactionWithRetry = async (tx, walletName, attempt = 0) => {
            try {
                const ret = await sendBundles([tx]);
                console.log(chalk.greenBright(`Transaction successful for wallet ${walletName}`));
                return ret;
            } catch (error) {
                if (attempt < maxRetries) {
                    console.warn(`Error sending transaction for ${walletName}, attempt ${attempt + 1}:`, error);
                    await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1))); // Exponential backoff
                    return sendTransactionWithRetry(tx, walletName, attempt + 1); // Retry transaction
                } else {
                    console.error(`Transaction failed for ${walletName} after ${maxRetries} attempts:`, error);
                    return null;
                }
            }
        };

        // Map wallet numbers to corresponding wallet objects
        const selectedWallets = walletNumbers.map(number => krypticWallets[number]);
        if (!selectedWallets.every(wallet => wallet)) {
            console.log("💥💥💥 One or more wallets do not exist. Please check the input.");
            return;
        }

        for (const wallet of selectedWallets) {
            const privateKey = wallet.key;
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
            const tokenBalance = await getSafeTokenBalance(keypair.publicKey, tokenMint);

            if (tokenBalance > 0) {
                let txSell = await buildSellTx(program, keypair, tokenMint);
                const recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;

                let newInnerTransactions = [...txSell.instructions];
                newInnerTransactions.push(
                    SystemProgram.transfer({
                        fromPubkey: keypair.publicKey,
                        toPubkey: tipAccount,
                        lamports: LAMPORTS_PER_SOL * JITO_TIP,
                    })
                );

                const transactionMessage = new TransactionMessage({
                    payerKey: keypair.publicKey,
                    instructions: newInnerTransactions,
                    recentBlockhash,
                });

                const tx = new VersionedTransaction(transactionMessage.compileToV0Message());
                tx.sign([keypair]);

                const transactionPromise = sendTransactionWithRetry(tx, wallet.name);
                pendingBundlePromises.push(transactionPromise);
            } else {
                console.log(`${wallet.name} has no tokens to sell.`);
            }
        }

        const results = await Promise.all(pendingBundlePromises);
        console.log("pendingBundleResponse: ", results);
        if (results.length > 0) {
            const succeed = results.some(result => result);
            if (!succeed) {
                console.log("Selling Error");
            }
        }
    } catch (error) {
        console.log("error:", error);
    }
};


const sellPercentTokens = async (walletIndices, lowPercentage, highPercentage) => {
    try {
        let tokenMint;
        if (GLOBAL_useNativeToken()) {
            const lastUsed = CONFIG_lastUsedToken();
            if (!lastUsed) {
                console.log("❌ No last native token found.");
                process.exit(1);
            }
            tokenMint = new PublicKey(lastUsed);
        } else {
            const tokenAccount = await getKeypairFromBase58(getConfig().TOKEN_PK);
            tokenMint = tokenAccount.publicKey;
        }
        console.log("LAST TOKEN",tokenMint)
        const provider = new anchor.AnchorProvider(
            connection,
            new anchor.Wallet(PAYER),
            anchor.AnchorProvider.defaultOptions()
        );
        const tipAddrs = await getTipAccounts();
        const tipAccount = new PublicKey(tipAddrs[getRandomNumber(0, tipAddrs.length - 1)]);
        const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);

        const pendingBundlePromises = [];
        const krypticWallets = [
            { name: 'Minter', address: PAYER_ADDRESS.toString(), key: process.env.MINTER_KEY },
        ];
        const keysFile = getConfig().keysFile;
        if (existsSync(keysFile)) {
            krypticWallets.push(...JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' })));
        }

        const maxRetries = 5;
        const retryDelay = 1000;

        const sendTransactionWithRetry = async (tx, walletName, attempt = 0) => {
            try {
                const ret = await sendBundles([tx]);
                console.log(`Transaction successful for wallet ${walletName}`);
                return ret;
            } catch (error) {
                if (attempt < maxRetries) {
                    console.warn(`Error sending transaction for ${walletName}, attempt ${attempt + 1}:`, error);
                    await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
                    return sendTransactionWithRetry(tx, walletName, attempt + 1);
                } else {
                    console.error(`Transaction failed for ${walletName} after ${maxRetries} attempts:`, error);
                    return null;
                }
            }
        };

        for (const walletIndex of walletIndices) {
            // Ensure the walletIndex is valid
            if (walletIndex < 0 || walletIndex >= krypticWallets.length) {
                console.log(`💥💥💥 Wallet at index ${walletIndex} does not exist. Please check.`);
                continue;
            }

            const wallet = krypticWallets[walletIndex];
            const privateKey = wallet['key'];
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
            const tokenBalance = await getSafeTokenBalance(keypair.publicKey, tokenMint);

            if (tokenBalance > 0) {
                const percentageToSell = lowPercentage + Math.random() * (highPercentage - lowPercentage);
                const tokensToSell = Math.floor((percentageToSell / 100) * tokenBalance);

                console.log(`${wallet.name} will sell ${tokensToSell} tokens (${percentageToSell.toFixed(2)}% of ${tokenBalance}).`);

                if (tokensToSell > 0) {
                    const txSell = await buildPercentSellTx(program, keypair, tokenMint, tokensToSell);
                    const recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

                    const transactionMessage = new TransactionMessage({
                        payerKey: keypair.publicKey,
                        instructions: [
                            ...txSell.instructions,
                            SystemProgram.transfer({
                                fromPubkey: keypair.publicKey,
                                toPubkey: tipAccount,
                                lamports: LAMPORTS_PER_SOL * JITO_TIP,
                            }),
                        ],
                        recentBlockhash,
                    });

                    const tx = new VersionedTransaction(transactionMessage.compileToV0Message());
                    tx.sign([keypair]);

                    const transactionPromise = sendTransactionWithRetry(tx, wallet.name);
                    pendingBundlePromises.push(transactionPromise);
                }
            } else {
                console.log(`${wallet.name} has no tokens to sell.`);
            }
        }

        const results = await Promise.all(pendingBundlePromises);

        if (results.some((result) => result)) {
            console.log('Some transactions succeeded.');
        } else {
            console.log('No transactions succeeded.');
        }
    } catch (error) {
        console.error('Error:', error);
    }
};



const splitTokensToWallets = async (lowPercentage, highPercentage, solLowAmount, solHighAmount) => {
    try {
        let tokenMint;
        if (GLOBAL_useNativeToken()) {
            const lastUsed = CONFIG_lastUsedToken();
            if (!lastUsed) {
                console.log("❌ No last native token found.");
                process.exit(1);
            }
            tokenMint = new PublicKey(lastUsed);
        } else {
            const tokenAccount = await getKeypairFromBase58(getConfig().TOKEN_PK);
            tokenMint = tokenAccount.publicKey;
        }

        // Fetch the token decimals
        const decimals = 6;

        console.log(`Token mint: ${tokenMint.toBase58()} | Decimals: ${decimals}`);

        const maxWallets = 22;
        const filePath = 'keysExtended.json';

        // Generate wallets if the file doesn't exist
        if (!fs.existsSync(filePath)) {
            const krypticWallets = [];

            for (let i = 0; i < maxWallets; i++) {
                const newKey = Keypair.generate();
                const newPk = bs58.encode(newKey.secretKey);
                const newAddr = newKey.publicKey.toString();
                const index = i + 1;
                krypticWallets.push({
                    name: `krypticEx${index}`,
                    address: newAddr,
                    key: newPk,
                });
            }

            fs.writeFileSync(filePath, JSON.stringify(krypticWallets, null, 2));
            console.log(chalk.greenBright("New wallets saved to keysExtended.json"));
        } else {
            console.log(chalk.yellowBright("keysExtended.json already exists. No new wallets were generated."));
        }

        // Start token distribution
        const sendingWallets = JSON.parse(fs.readFileSync('keys.json', { encoding: 'utf-8' })) || [];
        const receivingWallets = JSON.parse(fs.readFileSync(filePath, { encoding: 'utf-8' }));

        if (sendingWallets.length !== receivingWallets.length) {
            throw new Error("Number of sending wallets must match the number of receiving wallets.");
        }

        const solAmounts = [];
        const pendingTransfers = [];

        for (let i = 0; i < sendingWallets.length; i++) {
            const senderWallet = sendingWallets[i];
            const receiverWallet = receivingWallets[i];

            const privateKey = senderWallet.key;
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));

            // Fetch the token balance of the sender wallet
            const tokenBalance = await getSafeTokenBalance(keypair.publicKey, tokenMint);

            console.log(`Sender Wallet (${senderWallet.name}) Balance: ${tokenBalance} tokens`);

            if (tokenBalance > 0) {
                // Calculate the percentage of tokens to send
                const percentageToSend = lowPercentage + Math.random() * (highPercentage - lowPercentage);
                const tokensToSend = Math.floor((percentageToSend / 100) * tokenBalance);
                const tokensToSendInSmallestUnit = tokensToSend * Math.pow(10, decimals);

                console.log(
                    `Calculated Tokens to Send from ${senderWallet.name} to ${receiverWallet.name}: ${tokensToSendInSmallestUnit} (${percentageToSend.toFixed(2)}%)`
                );

                if (tokensToSendInSmallestUnit > 0) {
                    // Ensure ATA exists for the receiver
                    const receiverATAInfo = await ensureAssociatedTokenAccountExists(
                        connection,
                        PAYER,
                        new PublicKey(receiverWallet.address),
                        tokenMint
                    );

                    if (receiverATAInfo.instruction) {
                        console.log(chalk.yellowBright(`Creating receiver ATA for wallet: ${receiverWallet.name}`));
                        const createAtaTx = new Transaction().add(receiverATAInfo.instruction);
                        await connection.sendTransaction(createAtaTx, [PAYER], { skipPreflight: false });
                    }

                    const senderATA = await getAssociatedTokenAddress(tokenMint, keypair.publicKey);
                    const receiverATA = receiverATAInfo.associatedTokenAddress;

                    const transferIx = createTransferInstruction(
                        senderATA,
                        receiverATA,
                        keypair.publicKey,
                        tokensToSendInSmallestUnit
                    );

                    const tx = new Transaction().add(transferIx);
                    pendingTransfers.push({ tx, senderKeypair: keypair });
                }
            }

            // Generate random SOL amount within the specified range
            const solAmount = solLowAmount + Math.random() * (solHighAmount - solLowAmount);
            solAmounts.push(solAmount);
        }

        // Token Transfers
        for (const transfer of pendingTransfers) {
            try {
                const blockhash = (await connection.getLatestBlockhash()).blockhash;

                const tx = transfer.tx;
                tx.recentBlockhash = blockhash;
                tx.feePayer = PAYER.publicKey;
                tx.sign(PAYER, transfer.senderKeypair);

                const serializedTx = tx.serialize();
                const txid = await connection.sendRawTransaction(serializedTx, { skipPreflight: false });

                console.log(
                    chalk.greenBright(
                        `Successfully sent tokens from ${transfer.senderKeypair.publicKey.toString()} - TXID: ${txid}`
                    )
                );
            } catch (error) {
                console.log(chalk.redBright(`Token transfer failed:`, error));
            }
        }

        // Disperse SOL
        let retry = 0;
        const firstAddressLookup = new PublicKey("Ej3wFtgk3WywPnWPD3aychk38MqTdrjtqXkzbK8FpUih");
        const lookupTableAccount = await connection.getAddressLookupTable(firstAddressLookup);
        const lookupTableAccounts = [lookupTableAccount.value];

        while (1) {
            try {
                const bundleTxns = [];
                const instructions = [];

                for (let i = 1; i < solAmounts.length; i++) {
                    instructions.push(
                        SystemProgram.transfer({
                            fromPubkey: PAYER.publicKey,
                            toPubkey: new PublicKey(receivingWallets[i - 1].address),
                            lamports: parseInt(solAmounts[i] * LAMPORTS_PER_SOL),
                        })
                    );

                    if (i % INSTRUCTION_PER_TX === 0 || i === solAmounts.length - 1) {
                        if (i === solAmounts.length - 1) instructions.push(await getJitoTipInstruction(PAYER));

                        const versionedTransaction = new VersionedTransaction(
                            new TransactionMessage({
                                payerKey: PAYER.publicKey,
                                recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
                                instructions: instructions,
                            }).compileToV0Message(lookupTableAccounts)
                        );

                        versionedTransaction.sign([PAYER]);
                        bundleTxns.push(versionedTransaction);
                        instructions.length = 0;
                    }
                }

                const ret = await sendBundles(bundleTxns);
                if (ret) {
                    console.log(`Disperse SOL Success`);
                    break;
                }
            } catch (error) {
                console.log('Disperse SOL Error', error);
            }

            await sleep(1000 * 2 ** retry);
            retry++;
            if (retry >= MAX_RETRY) {
                console.log('Disperse SOL Failed');
                process.exit(1);
            }
        }

        console.log(chalk.greenBright.bold("Token distribution and SOL dispersion complete."));
    } catch (error) {
        console.log(chalk.redBright("Error during token split and SOL disperse:", error));
    }
};





const ensureAssociatedTokenAccountExists = async (connection, payer, walletPublicKey, mintPublicKey) => {
    const ata = await getAssociatedTokenAddress(mintPublicKey, walletPublicKey);
    const accountInfo = await connection.getAccountInfo(ata);

    if (!accountInfo) {
        const createAtaIx = createAssociatedTokenAccountInstruction(
            payer.publicKey, // Fee payer
            ata,             // Associated Token Account to be created
            walletPublicKey, // Wallet that will own the ATA
            mintPublicKey    // Token mint
        );
        return { instruction: createAtaIx, associatedTokenAddress: ata };
    }

    return { instruction: null, associatedTokenAddress: ata };
};


const generateKeys = async () => {
    try {
      const keysFile = getConfig().keysFile;
      const filePath = keysFile; // Define the file path for saving keys
      const maxWallets = WALLET_COUNT || 22; // Define the maximum number of wallets
  
      if (!fs.existsSync(filePath)) {
        const krypticWallets = [];
  
        for (let i = 0; i < maxWallets; i++) {
          const newKey = Keypair.generate();
          const newPk = bs58.encode(newKey.secretKey); // Encode secret key
          const newAddr = newKey.publicKey.toString(); // Get public key as string
          const index = i + 1; // Wallet index
  
          // Determine the wallet name based on filePath
          // (For the first wallet we will later treat it as the "Minter")
          const walletName =
            filePath === "keys.json" ? `kryptic${index}` : `krypticEx${index}`;
  
          // Initialize with extra fields for simulation results.
          krypticWallets.push({
            name: walletName,      // Wallet name
            address: newAddr,      // Public key address
            key: newPk,            // Secret key
            expectedSolAmount: 0,  // Will be updated by simulation
            expectedTokenAmount: 0 // Will be updated by simulation
          });
        }
  
        fs.writeFileSync(filePath, JSON.stringify(krypticWallets, null, 2)); // Save to file
        console.log(chalk.greenBright(`New wallets saved to ${keysFile}`));
      } else {
        console.log(chalk.yellowBright(`${keysFile} already exists. No new wallets were generated.`));
      }
    } catch (error) {
      console.log(chalk.redBright("Error generating wallets:", error));
    }
  };



  async function buildBuyTxFromInstructions(connection, signerKeypair, tokenMint, tokenAmount, solAmount) {
    // Create an Anchor provider using your global PAYER.
    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(PAYER),
      anchor.AnchorProvider.defaultOptions()
    );
    // Create your program instance.
    const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
    
    // Build the instructions using your provided buildBuyInstruction function.
    // Note: tokenMint must be a PublicKey.
    const instructions = await buildBuyInstruction(
      program,
      signerKeypair,
      new PublicKey(tokenMint),
      tokenAmount,
      solAmount
    );
    
    // Fetch a fresh blockhash.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
    
    // Create a TransactionMessage with the instructions.
    const txMessage = new TransactionMessage({
      payerKey: signerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: instructions,
    });
    
    // Compile the message into a v0 message.
    const compiledMessage = txMessage.compileToV0Message();
    const tx = new VersionedTransaction(compiledMessage);
    
    // Set fee payer, blockhash and last valid block height.
    tx.feePayer = signerKeypair.publicKey;
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    
    // Sign the transaction (only your walletKeypair is needed).
    tx.sign([signerKeypair]);
    
    return tx;
  }






  const supportBuys = async (contractAddress, walletCount, buyLow, buyHigh) => {
    try {
      // Validate parameters.
      if (
        !contractAddress ||
        walletCount <= 0 ||
        buyLow <= 0 ||
        buyHigh <= 0 ||
        buyLow > buyHigh
      ) {
        console.log("❌ Invalid parameters passed to supportBuys.");
        return;
      }
  
      console.log(`✅ Using contract address: ${contractAddress}`);
      console.log(`✅ Using ${walletCount} wallets`);
      console.log(`✅ Buy range set: ${buyLow} SOL - ${buyHigh} SOL`);
  
      let supportWallets = [];
      const keysFile = "supportkeys.json";
  
      // Load existing wallets from file or create new ones if needed.
      if (existsSync(keysFile)) {
        supportWallets = JSON.parse(readFileSync(keysFile, { encoding: "utf-8" })) || [];
      }
      while (supportWallets.length < walletCount) {
        const newKey = Keypair.generate();
        const newPk = bs58.encode(newKey.secretKey);
        const newAddr = newKey.publicKey.toString();
        const index = supportWallets.length + 1;
  
        supportWallets.push({
          name: `support${index}`,
          address: newAddr,
          key: newPk,
          buyAmount: 0,
        });
      }
      writeFileSync(keysFile, JSON.stringify(supportWallets, null, 2));
      console.table(supportWallets);
  
      // Validate buyHigh value.
      if (!buyHigh || isNaN(buyHigh)) {
        console.error("❌ buyHigh is undefined or invalid.");
        return;
      }
  
      // Assign random buy amounts and calculate total funding (with a 0.05 SOL buffer).
      let solAmounts = supportWallets.map((wallet) => {
        let randomBuy = Number((Math.random() * (buyHigh - buyLow) + buyLow).toFixed(4));
        if (isNaN(randomBuy) || randomBuy <= 0) {
          console.error(`❌ Invalid random buy amount generated: ${randomBuy}`);
          randomBuy = buyLow; // Fallback to buyLow.
        }
        return {
          ...wallet,
          buyAmount: randomBuy,
          totalFundAmount: Number((randomBuy + 0.03).toFixed(4)),
        };
      });
      writeFileSync(keysFile, JSON.stringify(solAmounts, null, 2));
  
      // Distribute SOL to support wallets (using bundled transactions with a tip).
      console.log("➡️ Distributing SOL to support wallets...");
      const distributeTxns = [];
      const distributeInstructions = [];
      const lookupTableAccount = await connection.getAddressLookupTable(
        new PublicKey("Ej3wFtgk3WywPnWPD3aychk38MqTdrjtqXkzbK8FpUih")
      );
      const lookupTableAccounts = [lookupTableAccount.value];
  
      for (let i = 0; i < solAmounts.length; i++) {
        const fundAmountLamports = Math.floor(solAmounts[i].totalFundAmount * LAMPORTS_PER_SOL);
        if (isNaN(fundAmountLamports) || fundAmountLamports <= 0) {
          console.error(`❌ Invalid SOL amount for wallet ${solAmounts[i].address}`);
          continue;
        }
        distributeInstructions.push(
          SystemProgram.transfer({
            fromPubkey: KRYPTIC_ADDRESS,
            toPubkey: (await getKeypairFromBase58(solAmounts[i].key)).publicKey,
            lamports: fundAmountLamports,
          })
        );
  
        if ((i + 1) % INSTRUCTION_PER_TX === 0 || i === solAmounts.length - 1) {
          distributeInstructions.push(await getJitoTipInstruction(PAYER));
          const distributeTransaction = new VersionedTransaction(
            new TransactionMessage({
              payerKey: KRYPTIC_ADDRESS,
              recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
              instructions: distributeInstructions,
            }).compileToV0Message(lookupTableAccounts)
          );
          distributeTransaction.sign([PAYER]);
          distributeTxns.push(distributeTransaction);
          distributeInstructions.length = 0;
        }
      }
      const retDistribute = await sendBundles(distributeTxns);
      if (!retDistribute)
        throw new Error("❌ Distribute SOL bundle submission failed");
      console.log("✔️ SOL Distribution Successful");
  
      // Prepare for sequential simulation of token amounts.
      // Calculate each wallet's trade amount (buyAmount minus buffer).
      const tradeAmounts = solAmounts.map(wallet =>
        parseFloat((Number(wallet.buyAmount) - 0.05).toFixed(3))
      );
      // Simulate sequential buys based on the initial pool state.
      const simulatedTokenOutputs = await simulateSequentialBuys(
        connection,
        new PublicKey(contractAddress),
        tradeAmounts
      );
  
      // Build and send the trade transactions concurrently.
      console.log("➡️ Building and sending trade transactions concurrently via on-chain logic...");
      const pendingBundlePromises = [];
      let transactionCounter = 0;
  
      // Function to send a bundle transaction.
      const sendTransaction = async (txBundle, walletName) => {
        try {
          const ret = await sendFastBundles(txBundle);
          console.log(`✅ Buy Order Completed Successfully for ${walletName}`);
          return ret;
        } catch (error) {
          console.error(`❌ Buy transaction failed for ${walletName}:`, error);
          return null;
        }
      };
  
      for (let i = 0; i < solAmounts.length; i++) {
        try {
          const wallet = solAmounts[i];
          const walletKeypair = Keypair.fromSecretKey(bs58.decode(wallet.key));
          if (!walletKeypair || !walletKeypair.publicKey) {
            throw new Error(`Invalid keypair for wallet ${wallet.name}`);
          }
          const solAmountStr = wallet.buyAmount.toFixed(3);
          const tradeAmount = tradeAmounts[i];
          console.log(
            `🟣 Building trade transaction for ${wallet.name} with ${solAmountStr} SOL (trade amount: ${tradeAmount} SOL)`
          );
  
          // Use the simulated token amount for this wallet.
          const tokenAmount = simulatedTokenOutputs[i];
          console.log(`Calculated token amount for ${wallet.name}: ${tokenAmount}`);
  
          // Build the buy transaction using our helper.
          const buyTx = await buildBuyTxFromInstructions(
            connection,
            walletKeypair,
            contractAddress, // token mint address as PublicKey.
            tokenAmount,     // expected token output.
            tradeAmount      // SOL being spent.
          );
  
          // Build the tip transaction.
          const tipTx = await buildTipTx(connection, walletKeypair);
  
          // Push the promise to send the bundle (buyTx and tipTx) to the pending array.
          pendingBundlePromises.push(sendTransaction([buyTx, tipTx], wallet.name));
          transactionCounter++;
  
       
            await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error(`❌ Buy transaction failed for ${solAmounts[i].name}:`, error);
        }
      }
  
      // Execute all transaction promises concurrently.
      const results = await Promise.all(pendingBundlePromises);
      console.log("✔️ All buy transactions processed.");
      console.log("Results:", results);
    } catch (error) {
      console.error("❌ Error in supportBuys:", error);
    }
  };

  async function buildTipTx(connection, signerKeypair) {
    // Fetch a fresh blockhash.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
    // Build the tip instruction using your existing function.
    const tipInstruction = await getJitoTipInstruction(signerKeypair);
  
    // Create a TransactionMessage for the tip.
    const tipTxMessage = new TransactionMessage({
      payerKey: signerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [tipInstruction],
    });
    const tipTxCompiled = tipTxMessage.compileToV0Message([]);
    const tipTx = new VersionedTransaction(tipTxCompiled);
  
    tipTx.feePayer = signerKeypair.publicKey;
    tipTx.recentBlockhash = blockhash;
    tipTx.lastValidBlockHeight = lastValidBlockHeight;
  
    tipTx.sign([signerKeypair]);
  
    return tipTx;
  }
  



const sellSupportTokens = async (contractAddress) => {
    try {
        console.log(chalk.redBright.bold(`🚀 Selling all tokens for contract: ${contractAddress}`));

        // Initialize provider & program
        const provider = new anchor.AnchorProvider(
            connection,
            new anchor.Wallet(PAYER),
            anchor.AnchorProvider.defaultOptions()
        );

        const tipAddrs = await getTipAccounts();
        const tipAccount = new PublicKey(tipAddrs[getRandomNumber(0, tipAddrs.length - 1)]);
        const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
        const tokenMint = new PublicKey(contractAddress);

        const keysFile = 'supportKeys.json';
        let supportWallets = [];

        // Load wallets from supportKeys.json
        if (existsSync(keysFile))
            supportWallets = JSON.parse(readFileSync(keysFile, { encoding: 'utf-8' })) || [];
        else {
            console.log(chalk.redBright("❌ No support wallets found."));
            return;
        }

        console.log(chalk.blueBright(`Found ${supportWallets.length} wallets in supportKeys.json`));

        const pendingBundlePromises = [];
        let transactionCounter = 0;

        // Function to send transactions
        const sendTransaction = async (tx, walletName) => {
            try {
                const ret = await sendFastBundles([tx]);
                console.log(`✅ Transaction successful for ${walletName}`);
                return ret;
            } catch (error) {
                console.error(`❌ Transaction failed for ${walletName}:`, error);
                return null;
            }
        };

        for (let i = 0; i < supportWallets.length; i++) {
            const privateKey = supportWallets[i]['key'];
            const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
            const tokenBalance = await getSafeTokenBalance(keypair.publicKey, tokenMint);
            const recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;

            if (tokenBalance > 0) {
                let txSell = await buildSellTx(program, keypair, tokenMint);

                let newInnerTransactions = [...txSell.instructions];
                newInnerTransactions.push(
                    SystemProgram.transfer({
                        fromPubkey: keypair.publicKey,
                        toPubkey: tipAccount,
                        lamports: LAMPORTS_PER_SOL * JITO_TIP,
                    })
                );

                const transactionMessage = new TransactionMessage({
                    payerKey: keypair.publicKey,
                    instructions: newInnerTransactions,
                    recentBlockhash,
                });

                const tx = new VersionedTransaction(transactionMessage.compileToV0Message());
                tx.sign([keypair]);

                // Push transaction promise
                const transactionPromise = sendTransaction(tx, supportWallets[i]['name']);
                pendingBundlePromises.push(transactionPromise);

                // Introduce delay every 5 transactions
                transactionCounter++;
               
                  
                    await new Promise(resolve => setTimeout(resolve, 1000));
                
            } else {
                console.log(`⚠️ ${supportWallets[i]['name']} has 0 balance, skipping.`);
            }
        }

        // Execute all transactions concurrently
        const results = await Promise.all(pendingBundlePromises);

        console.log(chalk.greenBright("🚀 Sell transactions completed."));
        console.log("Results:", results);

        if (results.length > 0) {
            let succeed = false;
            for (let k = 0; k < results.length; k++) {
                if (results[k]) {
                    succeed = true;
                    break;
                }
            }
            if (!succeed) {
                console.log(chalk.redBright("❌ All sell transactions failed."));
            }
        }

    } catch (error) {
        console.log(chalk.redBright("❌ Error in sellSupportTokens:"), error);
    }
};


const claimSOLFromMiddleWallets = async () => {
  try {
    const keysFile = "middleKeys.json";
    let supportWallets = [];

    if (existsSync(keysFile)) {
      supportWallets = JSON.parse(readFileSync(keysFile, { encoding: "utf-8" })) || [];
    } else {
      console.log(chalk.redBright("❌ No support wallets found."));
      return;
    }

    console.log(chalk.blueBright(`📂 Found ${supportWallets.length} support wallet(s).`));

    const transactionPromises = [];
    const maxRetries = 3;
    const MIN_BALANCE = 5000; // Leave 5000 lamports behind (0.000005 SOL)

    // Function to send a transaction with retries
    const sendTransactionWithRetry = async (versionedTransaction, walletIndex, attempt = 0) => {
      try {
        // Simulate the transaction first (optional but recommended)
        const simulation = await connection.simulateTransaction(versionedTransaction);
        if (simulation.value.err) {
          throw new Error(`Simulation error: ${JSON.stringify(simulation.value.err)}`);
        }
        const txId = await connection.sendTransaction(versionedTransaction);
        await connection.confirmTransaction(txId);
        console.log(`✅ Transaction sent and confirmed for wallet ${supportWallets[walletIndex].name}: ${txId}`);
      } catch (error) {
        if (attempt < maxRetries) {
          console.warn(
            `⚠️ Error sending transaction for wallet ${supportWallets[walletIndex].name}, attempt ${attempt + 1}:`,
            error.message
          );
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
          return sendTransactionWithRetry(versionedTransaction, walletIndex, attempt + 1);
        } else {
          console.error(
            `❌ Transaction failed for wallet ${supportWallets[walletIndex].name} after ${maxRetries} attempts:`,
            error
          );
        }
      }
    };

    for (let i = 0; i < supportWallets.length; i++) {
      const wallet = supportWallets[i];
      const privateKey = wallet["key"];
      const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      // Convert stored address to a PublicKey (if necessary)
      const walletAddress =
        typeof wallet.address === "string" ? new PublicKey(wallet.address) : wallet.address;

      const solBalance = await connection.getBalance(walletAddress);
      console.log(chalk.yellow(`${wallet.name} balance: ${solBalance} lamports`));

      if (solBalance <= MIN_BALANCE) {
        console.log(
          chalk.redBright(`⚠️ Wallet ${wallet.name} has insufficient SOL (after leaving ${MIN_BALANCE} lamports), skipping.`)
        );
        continue;
      }

      const solToSend = solBalance - MIN_BALANCE;
      console.log(chalk.blueBright(`📤 Sending ${(solToSend / LAMPORTS_PER_SOL).toFixed(6)} SOL from ${wallet.name}...`));

      const instruction = SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: KRYPTIC_ADDRESS,
        lamports: solToSend,
      });

      const { blockhash } = await connection.getLatestBlockhash();
      const txMessage = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [instruction],
      });
      const versionedTransaction = new VersionedTransaction(txMessage.compileToV0Message([]));

      versionedTransaction.sign([keypair]);

      const transactionPromise = sendTransactionWithRetry(versionedTransaction, i);
      transactionPromises.push(transactionPromise);
    }

    await Promise.all(transactionPromises);
    console.log(chalk.greenBright("✅ Gathering SOL from support wallets completed."));
  } catch (error) {
    console.error("Error in gatherSupportSol:", error);
  }
};










module.exports = {
    buyPumpfunTokens,
    generatePumpfunKey,
    simulateBuyPumpfunTokens,
    gatherSol,
    checkWallets,
    sellAllTokens,
    sellTokens,
    buyDelayPumpfunTokens,
    checkSol,
    sellPercentageOfTokens,
    sellPercentTokens,
    splitTokensToWallets,
    generateKeys,
    testUpload,
    supportBuys,
    sellSupportTokens,
    gatherSupportSol,
    claimSOLFromMiddleWallets,
    singleBuy,
    singleSell,
    askQuestion,

    PF_NATIVE_deploySingle,
    PF_NATIVE_deployBundle,
    rl

}