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
} = require("@solana/web3.js");const bs58 = require('bs58');

const anchor = require('@project-serum/anchor');
const dotenv = require("dotenv");
const idl = require("../../../idl.json");

async function PF_signCreateTx(serializedTx, mintPubkey, isFreeCoinCreation = false) {
    const url = "https://frontend-api-v3.pump.fun/coins/sign-create-tx";
  
    // make sure to install or polyfill fetch in your Node environment:
    // npm install node-fetch
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serializedTx,
        mint: mintPubkey,
        isFreeCoinCreation,
      }),
    });
  
    if (!response.ok) {
      throw new Error(`sign-create-tx failed: ${response.status} ${response.statusText}`);
    }
  
    const { serializedTx: signedBase58 } = await response.json();
    return signedBase58;
  }
  

async function PF_getNewMintKey() {
    const url = "https://frontend-api-v3.pump.fun/vanity/random-mint-public-key";
  
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Origin": "https://pump.fun",
          "Referer": "https://pump.fun/",
        }
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
  
      const data = await response.json();
      return data.pubkey;
    } catch (error) {
      console.error("Error fetching public key:", error);
      return null;
    }
  }
  
const PUMPFUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
dotenv.config();
const PAYER_SECRET = bs58.decode(process.env.MINTER_KEY);
const PAYER = Keypair.fromSecretKey(PAYER_SECRET);
const PAYER_ADDRESS = PAYER.publicKey;
const RPC_URL = process.env.RPC_URL;
const connection = new Connection(
    RPC_URL,
    'confirmed',
);
  
  /**
   * Decodes a serialized Solana transaction and logs instructions matching the Anchor program
   * @param {string} serializedTx - Base58-encoded serialized transaction
   * @param {anchor.Program} program - Anchor Program instance (with IDL and provider)
   */
  async function decodeSerializedTransaction(serializedTx) {
    try {
      // ✅ Set up Anchor provider and program
      const provider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(PAYER),
        anchor.AnchorProvider.defaultOptions()
      );
      const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
  
      // ✅ Decode the base58 transaction
      const txBuffer = bs58.decode(serializedTx);
  
      let message;
      let isVersioned = false;
  
      // ✅ Try versioned deserialization first
      try {
        const versionedTx = VersionedTransaction.deserialize(txBuffer);
        message = versionedTx.message;
        isVersioned = true;
      } catch {
        // ✅ Fallback to legacy transaction
        const legacyTx = Transaction.from(txBuffer);
        message = legacyTx.compileMessage();
      }
  
      // ✅ Get instructions
      const instructions = isVersioned
        ? message.compiledInstructions
        : message.instructions;
  
      for (const ix of instructions) {
        const programId = isVersioned
          ? message.staticAccountKeys[ix.programIdIndex]
          : message.accountKeys[ix.programIdIndex];
  
        if (!programId) {
          console.warn("⚠️ Instruction missing program ID, skipping.");
          continue;
        }
  
        if (programId.toBase58() === program.programId.toBase58()) {
          try {
            const data = Buffer.from(ix.data ?? [], "base64");
            const decoded = program.coder.instruction.decode(data, "buffer");
            console.log("📥 Decoded Anchor instruction:", decoded);
          } catch (decodeErr) {
            console.warn("⚠️ Failed to decode Anchor instruction:", decodeErr.message);
          }
        } else {
          console.log(`🔍 Skipped instruction from ${programId.toBase58()}`);
        }
      }
  
      console.log("✅ DESERIALIZATION Complete.");
    } catch (e) {
      console.error("❌ Failed to decode transaction:", e.message);
    }
  }
  module.exports = {
    PF_getNewMintKey,
    PF_signCreateTx,             // ← newly exported
    decodeSerializedTransaction
  };
  