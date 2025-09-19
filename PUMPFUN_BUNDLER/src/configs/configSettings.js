const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const { askQuestion } = require("../bot");
const { CONFIG_toggleNativeMode } = require("./utils");

const configsDir = path.join(__dirname, '../../configs');
const defaultConfigFile = 'defaultConfig.json';

// Config loading function

const getConfig = () => {
    const configDir = path.join(__dirname, '../../configs');
    const defaultConfigPath = path.join(configDir, 'defaultConfig.json');

    try {
        const configData = fs.readFileSync(defaultConfigPath, 'utf-8');
        const config = JSON.parse(configData);

        // Check TOKEN_PK based on PF_useNative
        const useNative = config.PF_useNative || false;

        if (!useNative && (!config.TOKEN_PK || config.TOKEN_PK.trim() === '')) {
            CONFIG_toggleNativeMode();
            return config; // Return null to stop the app elsewhere
        }

        // ✅ If using Native Mode but no PF_lastUsedToken, add placeholder
        if (useNative && (!config.PF_lastUsedToken || config.PF_lastUsedToken.trim() === '')) {
            config.PF_lastUsedToken = "N/A"; // just set it blank initially
        }

        return config;
    } catch (error) {
        console.error("⚠️ Error reading defaultConfig.json:", error);
        return null;
    }
};



const updateConfigFile = async () => {
    const configFile = 'config.json';

    // Check if the config file exists, otherwise create a default one
    if (!fs.existsSync(configFile)) {
        fs.writeFileSync(
            configFile,
            JSON.stringify({ keysFile: 'keys.json', TOKEN_PK: '', PF_useNative: true, PF_lastUsedToken: 'N/A' }, null, 2)
        );
        console.log(
            chalk.greenBright("Default config file created with keys.json as the selected file.")
        );
    }

    // Centralize the prompt
    const promptMessage =
        chalk.whiteBright.bold("Choose the keys file to operate with:") +
        chalk.magentaBright.bold("\n1. keys.json") +
        chalk.blueBright.bold("\n2. keysExtended.json") +
        chalk.magentaBright.bold("\nEnter your choice (1 or 2): ");

    const choice = await new Promise((resolve) => {
        rl.question(promptMessage, (input) => resolve(input));
    });

    let selectedFile;
    if (choice === '1') {
        selectedFile = 'keys.json';
    } else if (choice === '2') {
        selectedFile = 'keysExtended.json';
    } else {
        console.log(chalk.redBright("⚠️ Invalid choice. Please enter 1 or 2."));
        return; // Exit without making changes
    }

    try {
        // Read existing config
        const config = fs.existsSync(configFile)
            ? JSON.parse(fs.readFileSync(configFile, 'utf-8'))
            : {};

        // Update the keysFile property
        config.keysFile = selectedFile;

        // Write the updated config back to the file
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

        console.log(chalk.greenBright(`Configuration updated! Now using ${selectedFile}.`));

        // Wait for user to confirm return to main menu
        await new Promise((resolve) => {
            rl.question("\nPress Enter to return to the main menu...", () => {
                process.stdout.write('\x1Bc'); // Clear the console
                resolve();
            });
        });

        // Refresh the menu
        await startInteractiveMenu();
    } catch (error) {
        console.log(chalk.redBright("⚠️ Error updating config file:", error));
    }
};


const ensureConfigsDir = () => {
    if (!fs.existsSync(configsDir)) {
        fs.mkdirSync(configsDir);
    }
};

const listConfigs = () => {
    ensureConfigsDir();
    const files = fs.readdirSync(configsDir).filter(f => f.endsWith('.json'));
    console.log(chalk.yellowBright('\nAvailable Config Files:'));
    files.forEach((file, i) => {
        const marker = file === defaultConfigFile ? chalk.greenBright(' (active)') : '';
        console.log(`${chalk.green(i + 1)}. ${file}${marker}`);
    });
    return files;
};

const setDefaultConfig = async () => {
    const files = listConfigs();
    const choice = await askQuestion("\nEnter the number of the config to set as default: ");
    const index = parseInt(choice);
    if (!index || index < 1 || index > files.length) {
        console.log(chalk.redBright("Invalid selection."));
        return;
    }
    const selectedFile = files[index - 1];
    const selectedPath = path.join(configsDir, selectedFile);
    const defaultPath = path.join(configsDir, defaultConfigFile);
    fs.copyFileSync(selectedPath, defaultPath);
    console.log(chalk.greenBright(`\n✅ ${selectedFile} set as default config.`));
};

const createNewConfig = async () => {
    const name = await askQuestion("Enter a name for your new config file (without .json): ");
    const filename = `${name}.json`;
    const fullPath = path.join(configsDir, filename);
    const baseConfig = {
        TOKEN_PK: '',
        keysFile: 'keys.json',
        PF_useNative: true,
        PF_lastUsedToken: 'N/A'
    };
    fs.writeFileSync(fullPath, JSON.stringify(baseConfig, null, 2));
    console.log(chalk.greenBright(`\n✅ ${filename} created.`));
};

const deleteConfig = async () => {
    const files = listConfigs().filter(f => f !== defaultConfigFile);
    if (files.length === 0) {
        console.log(chalk.redBright("No deletable configs available."));
        return;
    }
    const choice = await askQuestion("Enter the number of the config to delete: ");
    const index = parseInt(choice);
    if (!index || index < 1 || index > files.length) {
        console.log(chalk.redBright("Invalid selection."));
        return;
    }
    const selectedFile = files[index - 1];
    const selectedPath = path.join(configsDir, selectedFile);
    fs.unlinkSync(selectedPath);
    console.log(chalk.greenBright(`\n🗑️ ${selectedFile} deleted.`));
};



module.exports = {
    listConfigs,
    setDefaultConfig,
    createNewConfig,
    deleteConfig,
    ensureConfigsDir,
    getConfig,
    updateConfigFile,
    
};
