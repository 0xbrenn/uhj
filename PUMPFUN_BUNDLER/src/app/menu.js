const figlet = require('figlet');
const chalk = require('chalk');
const readline = require('readline');
const fs = require("fs");
const dotenv = require("dotenv");
const { Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const bs58 = require('bs58');
dotenv.config();

const getKeypairFromBase58 = async (pk) => {
    return Keypair.fromSecretKey(bs58.decode(pk));
}

const {
    getConfig,
    listConfigs,
    setDefaultConfig,
    createNewConfig,
    deleteConfig,
    ensureConfigsDir
  } = require('../configs/configSettings');
  
const {
GLOBAL_useNativeToken,
CONFIG_lastUsedToken,
CONFIG_toggleNativeMode,
  } = require('../configs/utils');

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
    rl, 
    PF_NATIVE_deployBundle} = 
    require("../bot");

async function HANDLER_handleUserSelection(choice) {
    // Function to handle async readline input



switch (choice) {
case '1':
    process.stdout.write('\x1Bc'); // Clear the console and history
    console.log(chalk.redBright.bold("Starting To Simulate..."));
    await simulateBuyPumpfunTokens();
    console.log(chalk.greenBright.bold("Simulation Complete."));

    // Wait for user input to return to the main menu
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;
case '2':
    console.clear()
    console.log(chalk.redBright.bold(`\n\nGenerating New Contract Ending In ${process.env.END_TEXT} ...`));
    await generatePumpfunKey();
    console.log("Key Generation Complete and saved to config.json.");
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;

case '3':
    console.clear()
    console.log(chalk.redBright.bold("Generating Wallets"));
    await generateKeys();
    console.log(chalk.greenBright.bold("Wallets Generated"));
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;

// Launch Options
case '4':
    console.clear();

    if (GLOBAL_useNativeToken()) {
        console.log(chalk.magentaBright.bold("🚀 Launching Native Vanity Deploy (Block 0 on Pump.fun)..."));
        await PF_NATIVE_deployBundle();
    } else {
        console.log(chalk.yellowBright.bold("🚀 Launching Custom Address Deploy (Block 0 on Pump.fun)..."));
        await buyPumpfunTokens();
    }

    console.log(chalk.greenBright.bold("✅ Token Launch Complete."));
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;


case '5':
    console.log(chalk.redBright.bold("Launching Block 0-1 On Pump.Fun..."));
    await buyDelayPumpfunTokens();
    console.log(chalk.greenBright.bold("Token Launch Complete."));
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;

// Sell Options
case '6':
    console.clear()
    console.log(chalk.redBright.bold("Selling All Tokens..."));
    await sellAllTokens();
    console.log(chalk.greenBright.bold("All Tokens Sold."));
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;

case '7':
    console.clear()
    rl.question(
        chalk.whiteBright.bold("Enter the low and high percentages separated by a comma (e.g., 10,50): "),
        async (input) => {
            if (input) {
                const percentages = input.split(',').map((value) => parseFloat(value.trim()));
                const highPercentage = percentages[1];
                const lowPercentage = percentages[0];

                // Validate percentages
                if (
                    percentages.length !== 2 ||
                    isNaN(highPercentage) ||
                    isNaN(lowPercentage) ||
                    highPercentage < 0 ||
                    lowPercentage < 0 ||
                    highPercentage > 100 ||
                    lowPercentage > 100 ||
                    lowPercentage > highPercentage
                ) {
                    console.log(chalk.bgRedBright.bold("⚠️ Invalid input. Please enter two valid percentages between 0 and 100, with low <= high."));
                } else {
                    console.log(chalk.redBright.bold(`Selling ${lowPercentage}% to ${highPercentage}% of tokens for all wallets...`));
                    await sellPercentageOfTokens(highPercentage, lowPercentage);
                    console.log(chalk.greenBright.bold("Tokens Sold."));
                    await new Promise((resolve) => {
                        rl.question("\nPress Enter to return to the main menu...", () => {
                            process.stdout.write('\x1Bc'); // Clear again before returning to menu
                            resolve();
                            MENU_startInteractiveMenu()
                           

                        });
                       
                    });
                }
            } else {
                console.log(chalk.bgRedBright.bold("⚠️ Invalid input. Please enter high and low percentages separated by a comma."));
            }
        }
    );
    break;

case '8':
    console.clear()
    rl.question(chalk.whiteBright.bold("Enter wallet numbers separated by commas (0 for minter): "), async (walletNumbers) => {
        if (walletNumbers) {
            const walletArray = walletNumbers.split(',').map(Number);
            console.log(chalk.redBright.bold("Selling Tokens For Specified Wallets..."));
            await sellTokens(walletArray);
            console.log(chalk.greenBright.bold("Token Successfully Sold."));
            await new Promise((resolve) => {
                rl.question("\nPress Enter to return to the main menu...", () => {
                    process.stdout.write('\x1Bc'); // Clear again before returning to menu
                    resolve();
                    MENU_startInteractiveMenu()
                   
                });
               
            });
        } else {
            console.log(chalk.bgRedBright.bold("⚠️ Invalid input. Please enter wallet numbers."));
        }
    });
    break;

case '9':
    console.clear()
    rl.question(
        chalk.whiteBright.bold("Enter wallet numbers separated by commas (0 for minter): "),
        async (walletNumbers) => {
            if (walletNumbers) {
                const walletArray = walletNumbers.split(',').map(Number);
                rl.question(
                    chalk.whiteBright.bold("Enter the low and high percentages separated by a comma (e.g., 50,100): "),
                    async (percentages) => {
                        if (percentages) {
                            const [low, high] = percentages.split(',').map(value => parseFloat(value.trim()));
                            if (
                                isNaN(low) ||
                                isNaN(high) ||
                                low < 0 ||
                                high < 0 ||
                                low > 100 ||
                                high > 100 ||
                                low > high
                            ) {
                                console.log(chalk.bgRedBright.bold("⚠️ Invalid percentages. Please enter valid numbers."));
                                return;
                            }
                            console.log(chalk.redBright.bold("Selling Tokens For Specified Wallets..."));
                            await sellPercentTokens(walletArray, low, high);
                            console.log(chalk.greenBright.bold("Token Successfully Sold."));
                            await new Promise((resolve) => {
                                rl.question("\nPress Enter to return to the main menu...", () => {
                                    process.stdout.write('\x1Bc'); // Clear again before returning to menu
                                    resolve();
                                    MENU_startInteractiveMenu()
                                   
                                });
                                
                            });
                        } else {
                            console.log(chalk.bgRedBright.bold("⚠️ Invalid input. Please enter percentages."));
                        }
                    }
                );
            } else {
                console.log(chalk.bgRedBright.bold("⚠️ Invalid input. Please enter wallet numbers."));
            }
        }
    );
    break;

// Utils
case '10':
    console.clear()
    console.log(chalk.redBright.bold("Gathering SOL From Kryptic Wallets..."));
    await gatherSol();
    console.log(chalk.greenBright.bold("SOL Gathered From Kryptic Wallets..."));
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;

case '11':
    console.clear()
    console.log(chalk.redBright.bold("Checking Wallets For Tokens..."));
    await checkWallets();
    console.log(chalk.greenBright.bold("Wallet check complete."));
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;

    case '18':
        console.clear()
        console.log(chalk.redBright.bold("Claiming..."));
        await claimSOLFromMiddleWallets();
        console.log(chalk.greenBright.bold("Wallet claim complete."));
        await new Promise((resolve) => {
            rl.question("\nPress Enter to return to the main menu...", () => {
                process.stdout.write('\x1Bc'); // Clear again before returning to menu
                resolve();
            });
        });
        break;

case '12':
    console.clear()
    console.log(chalk.redBright.bold("Checking Kryptic Wallets For SOL..."));
    await checkSol();
    console.log(chalk.greenBright.bold("Kryptic Wallets SOL Check Complete."));
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;

case '13':
    console.clear()
    console.log(chalk.redBright.bold("Splitting Tokens and Dispersing SOL"));
    rl.question(
        chalk.whiteBright.bold("Enter the percentage range for tokens (low,high): "),
        async (percentageRange) => {
            const [lowPercentage, highPercentage] = percentageRange.split(',').map((value) => parseFloat(value.trim()));

            if (
                isNaN(lowPercentage) ||
                isNaN(highPercentage) ||
                lowPercentage < 0 ||
                highPercentage > 100 ||
                lowPercentage > highPercentage
            ) {
                console.log(chalk.redBright("⚠️ Invalid percentage range. Please enter values between 0 and 100."));
                rl.close();
                return;
            }

            rl.question(
                chalk.whiteBright.bold("Enter the SOL amount range (low,high in SOL): "),
                async (solRange) => {
                    const [solLowAmount, solHighAmount] = solRange.split(',').map((value) => parseFloat(value.trim()));

                    if (
                        isNaN(solLowAmount) ||
                        isNaN(solHighAmount) ||
                        solLowAmount < 0 ||
                        solLowAmount > solHighAmount
                    ) {
                        console.log(chalk.redBright("⚠️ Invalid SOL range. Please enter valid low and high SOL values."));
                        rl.close();
                        return;
                    }

                    console.log(
                        chalk.blueBright(
                            `Splitting tokens with percentage range: ${lowPercentage}-${highPercentage} and dispersing SOL with range: ${solLowAmount}-${solHighAmount}`
                        )
                    );

                    try {
                        await splitTokensToWallets(lowPercentage, highPercentage, solLowAmount, solHighAmount);
                        console.log(chalk.greenBright.bold("Split and Dispersion Complete"));
                        await new Promise((resolve) => {
                            rl.question("\nPress Enter to return to the main menu...", () => {
                                process.stdout.write('\x1Bc'); // Clear again before returning to menu
                                resolve();
                                MENU_startInteractiveMenu()
                               
                            });
                           
                        });
                    } catch (error) {
                        console.log(chalk.redBright("⚠️ Error during splitting and dispersion:", error));
                    }

                    rl.close();
                }
            );
        }
    );
    break;



    case '15':
        console.clear();
        console.log(chalk.redBright.bold("Support Buys"));
    
        try {
            const contractAddress = await askQuestion("Enter the contract address: ");
            if (!contractAddress) {
                console.log("❌ Invalid contract address.");
                return MENU_startInteractiveMenu();
            }
    
            let walletCountInput = await askQuestion("Enter the number of wallets to use: ");
            let walletCount = parseInt(walletCountInput);
            if (isNaN(walletCount) || walletCount <= 0) {
                console.log("❌ Invalid wallet count.");
                return MENU_startInteractiveMenu();
            }
    
            let buyLowInput = await askQuestion("Enter the buy low SOL amount: ");
            let buyLow = parseFloat(buyLowInput);
            if (isNaN(buyLow) || buyLow <= 0) {
                console.log("❌ Invalid buy low amount.");
                return MENU_startInteractiveMenu();
            }
    
            let buyHighInput = await askQuestion("Enter the buy high SOL amount: ");
            let buyHigh = parseFloat(buyHighInput);
            if (isNaN(buyHigh) || buyHigh <= 0 || buyHigh < buyLow) {
                console.log("❌ Invalid buy high amount.");
                return MENU_startInteractiveMenu();
            }
    
            // **DEBUG: Log input values**
            console.log(chalk.yellowBright(`🛠 DEBUG - buyLow: ${buyLow}, buyHigh: ${buyHigh}, walletCount: ${walletCount}`));
    
            console.log(chalk.greenBright.bold("✅ Inputs received, processing Support Buys..."));
            
            // Call supportBuys with user input
            await supportBuys(contractAddress, walletCount, buyLow, buyHigh);
    
            console.log(chalk.greenBright.bold("Success"));
    
            // Return to menu without closing `rl`
            await askQuestion("\nPress Enter to return to the main menu...");
            process.stdout.write('\x1Bc'); // Clear screen
            MENU_startInteractiveMenu();
    
        } catch (error) {
            console.log(chalk.redBright("❌ Error in Support Buys:"), error);
            MENU_startInteractiveMenu();
        }
        break;
    

    
    

case '14':
    console.clear()
    console.log(chalk.yellowBright.bold("Config Adjustments"));
    updateConfigFile();
    console.log(chalk.yellowBright.bold("Config Adjustments Complete"));
    await new Promise((resolve) => {
        rl.question("\nPress Enter to return to the main menu...", () => {
            process.stdout.write('\x1Bc'); // Clear again before returning to menu
            resolve();
        });
    });
    break;

    



    case '16':
console.clear();
console.log(chalk.redBright.bold("Sell Support Tokens"));


const contractAddress = await askQuestion("Enter the contract address: ");
if (!contractAddress) {
console.log("❌ Invalid contract address.");
return MENU_startInteractiveMenu();
}

console.log(chalk.greenBright.bold("✅ Inputs received, processing sell transactions..."));

await sellSupportTokens(contractAddress);

console.log(chalk.greenBright.bold("Success"));

await askQuestion("\nPress Enter to return to the main menu...");
process.stdout.write('\x1Bc');
MENU_startInteractiveMenu();
break;


case '17':
console.clear();
console.log(chalk.redBright.bold("Gather SOL from Support Wallets"));

console.log(chalk.greenBright.bold("✅ Gathering SOL..."));
await gatherSupportSol();

await askQuestion("\nPress Enter to return to the main menu...");
process.stdout.write('\x1Bc');
MENU_startInteractiveMenu();
break;

case '19':
    console.clear()
    console.log(chalk.yellowBright.bold("Exiting. Goodbye!"));
    rl.close();
    process.exit(0);
    break;
case '20':
                console.clear();
                console.log(chalk.blueBright.bold("🛠 Config Manager"));
            
                console.log(`${chalk.greenBright("1.")} List Configs`);
                console.log(`${chalk.greenBright("2.")} Set Default Config`);
                console.log(`${chalk.greenBright("3.")} Create New Config`);
                console.log(`${chalk.greenBright("4.")} Delete Config`);
            
                const configAction = await askQuestion("Select an option (1-4): ");
                switch (configAction) {
                    case '1':
                        listConfigs();
                        break;
                    case '2':
                        await setDefaultConfig();
                        break;
                    case '3':
                        await createNewConfig();
                        break;
                    case '4':
                        await deleteConfig();
                        break;
                    default:
                        console.log(chalk.red("Invalid option."));
                }
            
                await askQuestion("\nPress Enter to return to the main menu...");
                process.stdout.write('\x1Bc');
                MENU_startInteractiveMenu();
                break;
                case '21':
                    console.clear();
                    await CONFIG_toggleNativeMode();
                    await new Promise((resolve) => {
                        rl.question("\nPress Enter to return to the main menu...", () => {
                            process.stdout.write('\x1Bc');
                            resolve();
                        });
                    });
                    break;
                
            
default:
    console.log(chalk.bgRedBright.bold("⚠️ Invalid choice. Please select a valid option."));
}

// Show the menu again after handling the choice
await MENU_startInteractiveMenu();
}
async function MENU_startInteractiveMenu() {
    const config = getConfig();
    
    if (config && !config.PF_useNative && (!config.TOKEN_PK || config.TOKEN_PK.trim() === '')) {
        console.clear();
        console.log(chalk.redBright.bold("🚨 No valid TOKEN_PK found."));
        const answer = await askQuestion(chalk.cyan("Would you like to generate a new one now? (yes/no): "));
    
        if (answer.toLowerCase() === 'yes') {
            await generatePumpfunKey();
            console.log(chalk.greenBright("✅ New TOKEN_PK generated and saved."));
        } else {
            console.log(chalk.red("❌ Cannot continue without TOKEN_PK in custom mode. Exiting..."));
            rl.close();
            process.exit(0); // 👈 Exit properly if no custom key
        }
    }
    
    await MENU_ShowMenu();
    
    rl.question("Enter Your Choice: ", async (choice) => {
    await HANDLER_handleUserSelection(choice);
    });
    }

async function MENU_ShowMenu() {
    const config = getConfig();
    let tokenMint;
    try {
        if (!config.TOKEN_PK || config.TOKEN_PK.trim() === '') {
            throw new Error("No TOKEN_PK found");
        }
        const tokenAccount = await getKeypairFromBase58(config.TOKEN_PK);
        tokenMint = tokenAccount.publicKey;
    } catch (err) {

        tokenMint = "N/A"; // Fallback safe
    }
    

    console.log(chalk.blueBright.bold(figlet.textSync("PF Bundler", { horizontalLayout: 'default' })));
    console.log(chalk.gray("=============================================================="));
    console.log(chalk.whiteBright.bold("🚀 Contract Address:"), GLOBAL_useNativeToken()
    ? chalk.cyanBright("Native Address (No Contract)")
    : chalk.cyanBright(tokenMint.toString()));
    if (!GLOBAL_useNativeToken()) {
        console.log(chalk.whiteBright.bold("🌐 View on Pump.fun:"), chalk.greenBright.bold.underline(`https://pump.fun/coin/${tokenMint.toString()}`));
    }

    console.log(chalk.whiteBright.bold("🔑 Key Mode:"), GLOBAL_useNativeToken()
        ? chalk.greenBright("Native Mode (Random Key)")
        : chalk.yellowBright("Custom Key Mode"));
    if (GLOBAL_useNativeToken()) {
        console.log(chalk.whiteBright.bold("🆕 Last Deployed Native Token:"), chalk.cyanBright(CONFIG_lastUsedToken() || "None"));
    }
    console.log(chalk.whiteBright.bold("💕 Jito Tip:"), chalk.magentaBright(process.env.JITO_TIP + " SOL"));
    console.log(chalk.whiteBright.bold("🗂 Active Wallet File:"), chalk.magentaBright.bold(config.keysFile));
    console.log(chalk.gray("=============================================================="));

    // Menu sections
    console.log(chalk.yellowBright.bold("\nPrelaunch Options:"));
    console.log(`${chalk.greenBright("1.")} ${chalk.white("Simulate Bundle")}`);
    console.log(`${chalk.greenBright("2.")} ${chalk.white("Generate New Contract Address")}`);
    console.log(`${chalk.greenBright("3.")} ${chalk.white("Generate Wallets")}`);

    console.log(chalk.yellowBright.bold("\nLaunch Options:"));
    console.log(`${chalk.greenBright("4.")} ${chalk.white("Block 0 Launch On Pump.Fun")}`);
    console.log(`${chalk.greenBright("5.")} ${chalk.white("Block 0-1 Launch On Pump.Fun")}`);

    console.log(chalk.yellowBright.bold("\nSell Options:"));
    console.log(`${chalk.greenBright("6.")} ${chalk.white("Sell All Tokens")}`);
    console.log(`${chalk.greenBright("7.")} ${chalk.white("Sell Percent Of All Tokens")}`);
    console.log(`${chalk.greenBright("8.")} ${chalk.white("Sell Tokens For Specific Wallets")}`);
    console.log(`${chalk.greenBright("9.")} ${chalk.white("Sell Percent Tokens For Specific Wallets")}`);

    console.log(chalk.yellowBright.bold("\nUtils:"));
    console.log(`${chalk.greenBright("10.")} ${chalk.white("Gather SOL From Wallets")}`);
    console.log(`${chalk.greenBright("11.")} ${chalk.white("Check Wallets For Tokens")}`);
    console.log(`${chalk.greenBright("12.")} ${chalk.white("Check SOL In Wallets")}`);
    console.log(`${chalk.greenBright("13.")} ${chalk.white("Split Tokens To New Wallets and Disperse SOL")}`);
    console.log(`${chalk.greenBright("14.")} ${chalk.white("Switch Wallet File")}`);

    console.log(chalk.yellowBright.bold("\nSupport Options:"));
    console.log(`${chalk.greenBright("15.")} ${chalk.white("Support Buys")}`);
    console.log(`${chalk.greenBright("16.")} ${chalk.white("Sell Support Buys")}`);
    console.log(`${chalk.greenBright("17.")} ${chalk.white("Claim Support SOL")}`);

    console.log(chalk.yellowBright.bold("\nRandom Options:"));
    console.log(`${chalk.greenBright("18.")} ${chalk.white("Claim MidWallet SOL")}`);

    console.log(`${chalk.greenBright("19.")} ${chalk.white("Exit")}`);
    console.log(`${chalk.greenBright("20.")} ${chalk.white("Manage Configs (Load, Create, Delete)")}`);
    console.log(`${chalk.greenBright("21.")} ${chalk.white("Change KEY MODE (NATIVE/CUSTOM)")}`);

    console.log(chalk.gray("=============================================================="));
    console.log(chalk.cyanBright("\nPlease enter the number corresponding to your choice:"));
}



const MENU_showDisclaimer = () => {
    console.clear(); 
    console.log(chalk.blueBright.bold("⚠️ Disclaimer:"));
    console.log(chalk.yellowBright(`
By using this bot, you acknowledge and agree to the following:

1. ${chalk.bold("No Liability for Loss of Funds:")} 
   The bot is provided "as-is" and is for educational or experimental purposes only. We assume no responsibility for financial losses incurred during its use.

2. ${chalk.bold("No Guarantees of Performance:")} 
   The bot may contain errors or bugs that result in unintended outcomes. Use it at your own risk.

3. ${chalk.bold("Risk of Emotional Distress:")} 
   Cryptocurrency activities involve risk, including potential financial losses. We are not responsible for any emotional distress or frustration caused by the bot.

4. ${chalk.bold("User Responsibility:")} 
   You are fully responsible for all actions taken using this bot, including token purchases, sales, and wallet management.

5. ${chalk.bold("No Professional Advice:")} 
   This bot does not provide financial, investment, or legal advice. Conduct your own research or consult professionals before making financial decisions.

By proceeding, you acknowledge that you have read, understood, and agreed to this disclaimer.
    `));

    rl.question(chalk.cyanBright("Do you agree to the terms? (yes/no): "), (answer) => {
        if (answer.toLowerCase() === 'yes') {
            console.log(chalk.greenBright("Thank you for agreeing. The bot will now start."));
            console.clear()
            MENU_startInteractiveMenu(); 
        } else {
            console.log(chalk.redBright("You must agree to the terms to use this bot. Exiting..."));
            rl.close();
            process.exit(0);
        }
    });
};



module.exports = {
    MENU_ShowMenu,
    MENU_showDisclaimer,
    MENU_startInteractiveMenu
}