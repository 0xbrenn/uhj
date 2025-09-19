const figlet = require('figlet');
const chalk = require('chalk');
const readline = require('readline');
const fs = require("fs");
const dotenv = require("dotenv");
const { Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const bs58 = require('bs58');


    
dotenv.config();

const { MENU_showDisclaimer } = require('./src/app/menu');




// Start the interactive menu
MENU_showDisclaimer();


// cleaned and moved to other section to make repo easier to work with
