const axios = require("axios");
const bs58 = require("bs58");
const chalk = require('chalk');
const {
    bundle: { Bundle },
} = require("jito-ts");
const dotenv = require("dotenv");
dotenv.config();

const JITO_TIMEOUT = 250000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
exports.sendBundles = async (transactions) => {
    try {
        if (transactions.length === 0) {
            console.error(chalk.bgRed("❌ No transactions provided for simulation or submission."));
            return false;
        }

        console.log(chalk.blueBright("🚀 Submitting bundle to Jito..."));

        const encodedTransactionsBase58 = transactions.map((tx) => {
            const serialized = tx.serialize();
            return bs58.encode(serialized);
        });

        // 1. Submit the bundle
        const { data: sendData } = await axios.post(
            `https://mainnet.block-engine.jito.wtf/api/v1/bundles`,
            {
                jsonrpc: "2.0",
                id: 1,
                method: "sendBundle",
                params: [encodedTransactionsBase58],
            },
            {
                headers: { "Content-Type": "application/json" },
            }
        );

        // 2. Handle bundle submission error
        if (sendData.error) {
            console.error(
                chalk.bgRedBright("❌ Error during sendBundle:"),
                chalk.yellowBright(sendData.error.message)
            );
            if (sendData.error.data) {
                console.log(chalk.gray("📦 Error Data:"), JSON.stringify(sendData.error.data, null, 2));
            }
            return false;
        }

        const uuid = sendData.result;
        console.log("sendData",sendData);
        console.log(chalk.yellowBright(`📬 Bundle Submitted — UUID: ${uuid}`));
        console.log(chalk.gray("⏳ Waiting for bundle to finalize..."));

        const sentTime = Date.now();

        // 3. Poll for status updates
        while (Date.now() - sentTime < JITO_TIMEOUT) {
            await sleep(1000); // Wait 1 second between polls
            try {
                const { data: statusData } = await axios.post(
                    `https://mainnet.block-engine.jito.wtf/api/v1/bundles`,
                    {
                        jsonrpc: "2.0",
                        id: 1,
                        method: "getBundleStatuses",
                        params: [[uuid]],
                    },
                    {
                        headers: { "Content-Type": "application/json" },
                    }
                );

                // 4. Handle status check errors
                if (statusData.error) {
                    console.error(
                        chalk.bgRedBright("❌ Error during getBundleStatuses:"),
                        chalk.yellowBright(statusData.error.message)
                    );
                    return false;
                }

                const statuses = statusData.result.value;
                const matched = statuses.find((s) => s && s.bundle_id === uuid);

                if (matched) {
                    const status = matched.confirmation_status;
                    console.log(chalk.cyanBright(`🔄 Current Status: ${status}`));

                    if (["processed", "confirmed", "finalized"].includes(status)) {
                        console.log(chalk.greenBright("✅ Bundle Finalized Successfully!"));
                        console.log(chalk.greenBright(`🌐 View: https://explorer.jito.wtf/bundle/${uuid}\n`));
                        return true;
                    }
                } else {
                    console.log(chalk.gray("⏳ Waiting... bundle not yet confirmed."));
                }

            } catch (statusErr) {
                console.error(
                    chalk.bgRed("❌ Error while checking bundle status:"),
                    chalk.yellow(statusErr.message)
                );
            }
        }

        console.error(chalk.bgRedBright("⏰ Bundle status check timed out after 250s."));
        console.log(chalk.gray(`💡 You can check later: https://explorer.jito.wtf/bundle/${uuid}`));
        return false;

    } catch (err) {
        console.error(chalk.bgRedBright("❌ Unexpected error in sendBundles:"), chalk.red(err));
        return false;
    }
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
