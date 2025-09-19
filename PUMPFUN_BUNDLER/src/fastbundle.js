const axios = require("axios");
const bs58 = require("bs58");
const chalk = require('chalk');
const {
    bundle: { Bundle },
} = require("jito-ts");
const dotenv = require("dotenv");
dotenv.config();

const JITO_TIMEOUT = 150000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.sendFastBundles = async (transactions) => {
    try {
        if (transactions.length === 0) {
            console.error("No transactions provided for simulation or submission.");
            return false;
        }


        console.log("Simulating bundle...");
        const encodedTransactionsBase64 = transactions.map((tx) => {
            const serialized = tx.serialize();
            return Buffer.from(serialized).toString("base64");
        });

     

        const encodedTransactionsBase58 = transactions.map((tx) => {
            const serialized = tx.serialize();
            return bs58.encode(serialized);
        });

        try {
            const { data: sendData } = await axios.post(
                `https://mainnet.block-engine.jito.wtf/api/v1/bundles`,
                {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "sendBundle",
                    params: [encodedTransactionsBase58],
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                }
            );

            if (sendData.error) {
                console.error(
                    chalk.bold.bgRedBright("Error during sendBundle:", sendData.error.message)
                );
                return false;
            }

            const uuid = sendData.result;
            console.log(uuid)
           

            const sentTime = Date.now();
            while (Date.now() - sentTime < JITO_TIMEOUT) {
                try {
                  
                    const { data: statusData } = await axios.post(
                        `https://mainnet.block-engine.jito.wtf/api/v1/getBundleStatuses`,
                        {
                            jsonrpc: "2.0",
                            id: 1,
                            method: "getBundleStatuses",
                            params: [[uuid]],
                        },
                        {
                            headers: {
                                "Content-Type": "application/json",
                            },
                        }
                    );

                    if (statusData.error) {
                        console.error(
                            chalk.bold.bgRedBright(
                                "Error during getBundleStatuses:",
                                statusData.error.message
                            )
                        );
                        return false;
                    }

                    const bundleStatuses = statusData.result.value;
                    const matchedStatus = bundleStatuses.find(
                        (bStatus) => bStatus && bStatus.bundle_id === uuid
                    );

                    if (matchedStatus) {
                        
                        if (matchedStatus.confirmation_status === "processed" || matchedStatus.confirmation_status === "confirmed" ||matchedStatus.confirmation_status === "finalized") {
                           
                            return true;
                        }
                    } else {
                        
                    }
                } catch (statusError) {
                    console.error(
                        chalk.bold.redBright("Error while checking bundle status or to many requests:", statusError.message)
                    );
                }

                await sleep(1000); // Wait before retrying;
            }

            console.error(chalk.bold.bgRedBright("Bundle status check timed out."));
        } catch (sendError) {
            console.error(chalk.bold.bgRedBright("Error during bundle submission:", sendError.message));
            return false;
        }
    } catch (err) {
        console.error(chalk.bold.bgRedBright("Send Bundle Error:", err.message));
    }
    return false;
};


exports.getTipAccounts = async () => {
    return [
        "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
        "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
        "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
        "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
        "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
        "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
        "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
        "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
    ];
};
