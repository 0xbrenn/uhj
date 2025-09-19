const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

const configsDir = path.join(__dirname, '../../configs');
const defaultConfigFile = 'defaultConfig.json';


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

const GLOBAL_useNativeToken = () => {
    const config = getConfig();
    return !config || config.PF_useNative || !config.TOKEN_PK || config.TOKEN_PK.trim() === '';
};

const CONFIG_lastUsedToken = () => {
    const config = getConfig();
    if (!config) return null;

    return config.PF_lastUsedToken || null;
};
const CONFIG_updateLastUsedToken = (mintAddress) => {
    const configDir = path.join(__dirname, '../../configs');
    const defaultConfigPath = path.join(configDir, 'defaultConfig.json');

    const config = getConfig();
    if (!config) return;

    config.PF_lastUsedToken = mintAddress;

    fs.writeFileSync(defaultConfigPath, JSON.stringify(config, null, 2));
};
const CONFIG_toggleNativeMode = () => {
    const configDir = path.join(__dirname, '../../configs');
    const defaultConfigPath = path.join(configDir, 'defaultConfig.json');

    const config = getConfig();
    if (!config) return;

    config.PF_useNative = !config.PF_useNative; 

    fs.writeFileSync(defaultConfigPath, JSON.stringify(config, null, 2));
};

module.exports = {
    GLOBAL_useNativeToken,
    CONFIG_lastUsedToken,
    CONFIG_updateLastUsedToken,
    CONFIG_toggleNativeMode
}