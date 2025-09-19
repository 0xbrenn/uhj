const { AddressLookupTableProgram, Connection, Transaction,  TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const JITO = require('./jito');

const SOLANA_CONNECTION = new Connection(process.env.SOLANA_RPC_URL);
const TIMEOUT = 50000 

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

exports.getSignedVerTxWithLUT = async (_lookupTablePubkey, _instructions, _signers, _payer) => {

    // get all pubkeys in instructions
    let allPubkeys = [];
    _instructions.map((instruction) => {
        instruction.keys.map((key) => {
            const findResult = allPubkeys.find((item) => {
                return (item.toBase58() == key.pubkey.toBase58());
            });
            if (findResult) {
                return;
            } else {
                allPubkeys.push(key.pubkey);
            }
        });
        const findResult = allPubkeys.find((item) => {
            return (item.toBase58() == instruction.programId.toBase58());
        });
        if (findResult) {
            return;
        } else {
            allPubkeys.push(instruction.programId);
        }
    })

    allPubkeys.push(_payer.publicKey)

    // add to lookup table
    const result = await this.addAddressesToTable(_lookupTablePubkey, allPubkeys, _payer)
    
    if (!result) {
        console.log("Error while adding pubkeys ", allPubkeys.length, "to LookupTable ", _lookupTablePubkey, ".")
        return null
    }

    await sleep(5000)

    const recentBlockhash = (await SOLANA_CONNECTION.getLatestBlockhash()).blockhash;

    const lookupTableAccount = (await SOLANA_CONNECTION.getAddressLookupTable(_lookupTablePubkey)).value;
    if (!lookupTableAccount) {
        console.log("Error while getting Lookup Table Account. LookupTable Pubkey:", _lookupTablePubkey)
        return null
    }

    const txMsg = new TransactionMessage({
        instructions: _instructions,
        payerKey: _payer.publicKey,
        recentBlockhash,
    }).compileToV0Message([lookupTableAccount])

    const tx = new VersionedTransaction(txMsg)
    tx.sign([_payer, ..._signers])
    
    console.log('Compressed transaction size using address lookup table: ', tx.serialize().length, 'bytes');

    return tx
}


exports.getSignedVerTxArrWithLUT = async (_lookupTablePubkey, instructionsArray, signersArray, _payer) => {

    // get all pubkeys in instructions
    let allPubkeys = [];

    allPubkeys.push(_payer.publicKey)

    signersArray.map((_signers) => {
        _signers.map((signer) => {
            allPubkeys.push(signer.publicKey)
        })
    })

    instructionsArray.map(async (instructions) => {
        instructions.map((instruction) => {
            instruction.keys.map((key) => {
                const findResult = allPubkeys.find((item) => {
                    return (item.toBase58() == key.pubkey.toBase58());
                });
                if (findResult) {
                    return;
                } else {
                    allPubkeys.push(key.pubkey);
                }
            });
            const findResult = allPubkeys.find((item) => {
                return (item.toBase58() == instruction.programId.toBase58());
            });
            if (findResult) {
                return;
            } else {
                allPubkeys.push(instruction.programId);
            }
        })
    })

    // add to lookup table
    const result = await this.addAddressesToTable(_lookupTablePubkey, allPubkeys, _payer)
    
    if (!result) {
        console.log("Error while adding pubkeys ", allPubkeys.length, "to LookupTable ", _lookupTablePubkey, ".")
        return null
    }

    await sleep(5000)

    const recentBlockhash = (await SOLANA_CONNECTION.getLatestBlockhash()).blockhash;

    const lookupTableAccount = (await SOLANA_CONNECTION.getAddressLookupTable(_lookupTablePubkey)).value;
    if (!lookupTableAccount) {
        console.log("Error while getting Lookup Table Account. LookupTable Pubkey:", _lookupTablePubkey)
        return null
    }

    let versionedTxs = []

    for (let i = 0; i < instructionsArray.length; i++) {
        const instructions = instructionsArray[i]
        
        const txMsg = new TransactionMessage({
            instructions: instructions,
            payerKey: _payer.publicKey,
            recentBlockhash,
        }).compileToV0Message([lookupTableAccount])

        const tx = new VersionedTransaction(txMsg)
        tx.sign([_payer, ...signersArray[i]])

        versionedTxs.push(tx)

        console.log('Compressed transaction size using address lookup table ', i, ' : ', tx.serialize().length, 'bytes');
    }

    return versionedTxs
}


exports.createLookupTable = async (_signerKeypair) => {
    // Step 1 - Get a lookup table address and create lookup table instruction
    console.log("Creating Lookup Table. Address");

    const [lookupTableInst, lookupTablePubkey] =
        AddressLookupTableProgram.createLookupTable({
            authority: _signerKeypair.publicKey,
            payer: _signerKeypair.publicKey,
            recentSlot: (await SOLANA_CONNECTION.getSlot()) - 1,
        });


    // compose a trx
    const recentBlockhash = (await SOLANA_CONNECTION.getLatestBlockhash()).blockhash;

    const createLTableTrx = new Transaction()
    createLTableTrx.add(lookupTableInst);
    createLTableTrx.recentBlockhash = recentBlockhash
    createLTableTrx.sign(_signerKeypair)


    // Step 3 - Generate a transaction and send it to the network
    let result = await JITO.sendBundleTrxWithTip([createLTableTrx], _signerKeypair)

    if (result) {
        console.log("Successfully created Lookup Table. Address:", lookupTablePubkey.toBase58());

        // verify lookup Table
        let lookupTableAccount
        const startTime = Date.now();
        while (Date.now() - startTime < TIMEOUT) {

            console.log("verifing...")

            lookupTableAccount = (await SOLANA_CONNECTION.getAddressLookupTable(lookupTablePubkey));
            if (lookupTableAccount.value) return lookupTablePubkey;

            await sleep(1000);
        }
    }
    else {
        console.log("Error! Creating Lookup Table failed. Address:", lookupTablePubkey.toBase58());
    }

    console.log("")
    return null;
}


exports.addPubKeysToTable = async (_lookupTablePubkey, _pubKeys, _signerKeypair) => {
    console.log("Adding ", _pubKeys.length, "pubKeys", _pubKeys, " to LookupTable ", _lookupTablePubkey);

    // Fetching LookupTableAccount
    let lookupTableAccount
    const startTime = Date.now();
    while (Date.now() - startTime < TIMEOUT) {
        lookupTableAccount = (await SOLANA_CONNECTION.getAddressLookupTable(_lookupTablePubkey));
        if (lookupTableAccount.value) break;
        await sleep(1000)
    }
    
    if (!lookupTableAccount.value) {
        console.log("--- Error while fetching Lookup Table addresses ---")
        return null;
    }

    let initialkeyCount = lookupTableAccount.value.state.addresses ? lookupTableAccount.value.state.addresses.length : 0
    console.log("------- initialkeyCount:", initialkeyCount)

    // extracting new keys
    let newPubKeys = []
    _pubKeys.map((_pubKey) => {
        const findResult = lookupTableAccount.value.state.addresses.find((item) => {
            return (item.toBase58() == _pubKey.toBase58());
        })
        if (findResult) {
            return
        } else {
            newPubKeys.push(_pubKey);
        }
    })
    console.log("------- new key count:", newPubKeys.length)

    if (newPubKeys.length == 0) {
        console.log("------ No keys to add to Lookup Table -----")
        return lookupTableAccount
    }
    
    await sleep(3000)
    // Create Transaction Instruction
    const recentBlockhash = (await SOLANA_CONNECTION.getLatestBlockhash()).blockhash;

    let extendTxs = []
    for (let i = 0; ; i++) {
        let _newPubKeys = newPubKeys.slice(i*20, (i+1)*20)
        if (_newPubKeys.length == 0) break

        const addPubKeyInstruction = AddressLookupTableProgram.extendLookupTable({
            payer: _signerKeypair.publicKey,
            authority: _signerKeypair.publicKey,
            lookupTable: _lookupTablePubkey,
            addresses: _newPubKeys,
        });

        // Generate a transaction and send it to the network
        const addAddrTx = new Transaction()
        addAddrTx.add(addPubKeyInstruction);
        addAddrTx.recentBlockhash = recentBlockhash
        addAddrTx.sign(_signerKeypair)

        extendTxs.push(addAddrTx)
    }

    // Generate a transaction and send it to the network
    console.log("------ Sending extendLookupTable transaction.. ------")
    let result = await JITO.sendBundleTrxWithTip(extendTxs, _signerKeypair)

    // Checking result
    if (result) {
        console.log("transaction sent.");

        const startTime = Date.now();

        while (Date.now() - startTime < TIMEOUT) {

            console.log("---- verifing pubkeys... keyCount:", lookupTableAccount.value.state.addresses.length)
            
            lookupTableAccount = (await SOLANA_CONNECTION.getAddressLookupTable(_lookupTablePubkey));
            
            if (lookupTableAccount.value && lookupTableAccount.value.state && lookupTableAccount.value.state.addresses.length > initialkeyCount) {
                console.log("--- Successfully added to Lookup Table! ---")
                console.log(`https://explorer.solana.com/address/${_lookupTablePubkey.toString()}/entries?cluster=mainnet`)
                return lookupTableAccount
            }
            await sleep(1000)
        }
        console.log("--- Error while adding ", newPubKeys.length, " keys to Lookup Table. ---");
    }
    else {
        console.log("--- JITO failed for sending extendLookupTable. ---");
    }

    console.log(`Lookup Table Entries: https://explorer.solana.com/address/${_lookupTablePubkey.toString()}/entries?cluster=mainnet`)

    return null;
}


exports.addAllPubkeysInInstructions = async (_lookupTablePubkey, _instructions, _payer) => {

    // get all pubkeys in instructions
    allPubkeys.push(_payer.publicKey)

    let allPubkeys = [];
    _instructions.map((instruction) => {
        instruction.keys.map((key) => {
            const findResult = allPubkeys.find((item) => {
                return (item.toBase58() == key.pubkey.toBase58());
            });
            if (findResult) {
                return;
            } else {
                allPubkeys.push(key.pubkey);
            }
        });
        const findResult = allPubkeys.find((item) => {
            return (item.toBase58() == instruction.programId.toBase58());
        });
        if (findResult) {
            return;
        } else {
            allPubkeys.push(instruction.programId);
        }
    })

    // add to lookup table
    const result = await this.addAddressesToTable(_lookupTablePubkey, allPubkeys, _payer)
    
    if (!result) {
        console.log("Error while adding pubkeys ", allPubkeys.length, "to LookupTable ", _lookupTablePubkey, ".")
    }

    return result
}


exports.freezeLookupTable = async (_lookupTablePubkey, _signerKeypair) => {
    // Step 1 - Create Transaction Instruction
    const freezeLTInstruction = AddressLookupTableProgram.freezeLookupTable({
        authority: _signerKeypair.publicKey,
        lookupTable: _lookupTablePubkey,
    });

    const recentBlockhash = (await SOLANA_CONNECTION.getLatestBlockhash()).blockhash;

    // Compose a bundle Trx
    const freezeLTTrx = new Transaction()
    freezeLTTrx.add(freezeLTInstruction)
    freezeLTTrx.recentBlockhash = recentBlockhash
    freezeLTTrx.sign(_signerKeypair)

    // Step 2 - send trx to the network
    let result = await JITO.sendBundleTrxWithTip([freezeLTTrx], _signerKeypair)

    if (result) {
        console.log("Successfully freezed Lookup Table.");
    }
    else {
        console.log("Error while freezing Lookup Table.");
    }
    console.log(`Lookup Table Entries: `, `https://explorer.solana.com/address/${_lookupTablePubkey.toString()}/entries?cluster=mainnet`)

    return result
}


exports.deactivateLookupTable = async (_lookupTablePubkey, _signerKeypair) => {
    // Step 1 - Generate a transaction and send it to the network
    const deactivateLTInstruction = AddressLookupTableProgram.deactivateLookupTable({
        authority: _signerKeypair.publicKey,
        lookupTable: _lookupTablePubkey,
    })

    const recentBlockhash = (await SOLANA_CONNECTION.getLatestBlockhash()).blockhash;

    const deactivateLTTrx = new Transaction()
    deactivateLTTrx.add(deactivateLTInstruction)
    deactivateLTTrx.recentBlockhash = recentBlockhash
    deactivateLTTrx.sign(_signerKeypair)

    // Step 2 - Generate a transaction and send it to the network
    let result = await JITO.sendBundleTrxWithTip([deactivateLTTrx], _signerKeypair)

    if (result) {
        console.log("Successfully deactivated Lookup Table.");
    }
    else {
        console.log("Error while deactivating Lookup Table.");
    }

    console.log(`https://explorer.solana.com/address/${_lookupTablePubkey.toString()}/entries?cluster=mainnet`)

    return result
}


exports.closeLookupTable = async (_lookupTablePubkey, _signerKeypair) => {
    // Step 1 - Generate a transaction and send it to the network
    const closeLTInstruction = AddressLookupTableProgram.closeLookupTable({
        authority: _signerKeypair.publicKey,
        lookupTable: _lookupTablePubkey,
        recipient: _signerKeypair.publicKey
    })

    const recentBlockhash = (await SOLANA_CONNECTION.getLatestBlockhash()).blockhash;

    const closeLTTrx = new Transaction()
    closeLTTrx.add(closeLTInstruction)
    closeLTTrx.recentBlockhash = recentBlockhash
    closeLTTrx.sign(_signerKeypair)

    // Step 2 - Generate a transaction and send it to the network
    let result = await JITO.sendBundleTrxWithTip([closeLTTrx], _signerKeypair)

    if (result) {
        console.log("Successfully closed Lookup Table.");
    }
    else {
        console.log("Error while closing Lookup Table.");
    }

    console.log(`Lookup Table Entries: `, `https://explorer.solana.com/address/${_lookupTablePubkey.toString()}/entries?cluster=mainnet`)

    return result
}


exports.fetchAllAddrsInTable = async (_lookupTablePubkey) => {
    // Step 1 - Fetch our address lookup table
    const lookupTableAccount = await SOLANA_CONNECTION.getAddressLookupTable(_lookupTablePubkey)
    console.log(`Successfully found lookup table: `, lookupTableAccount.value?.key.toString());

    // Step 2 - Make sure our search returns a valid table
    if (!lookupTableAccount.value) {
        console.log("Error while fetching lookup Table addresses")
        return [];
    }

    // Step 3 - Log each table address to console
    for (let i = 0; i < lookupTableAccount.value.state.addresses.length; i++) {
        const address = lookupTableAccount.value.state.addresses[i];
        console.log(`Address ${(i + 1)}: ${address.toBase58()}`);
    }

    return [...lookupTableAccount.value.state.addresses]
}

exports.makeVerTxWithLUT = (_lookupTableAccount, _instructions, _recentBlockhash, signers, _payer) => {

    const txMsg = new TransactionMessage({
            instructions: _instructions,
            payerKey: _payer.publicKey,
            recentBlockhash: _recentBlockhash,
        }).compileToV0Message([_lookupTableAccount])

    const tx = new VersionedTransaction(txMsg)
    console.log("======= _recentBlockhash", _recentBlockhash)
    console.log("======= tx.recentBlockhash", tx.recentBlockhash)
    console.log("======= _instructions.len", _instructions.length)
    console.log("======= signers.len", signers.length)  
    
    tx.sign([_payer, ...signers])

    console.log("Compressed tx size: ", tx.serialize().length, "byte." )

    return tx
}

exports.getLUTAccount = async (_lookupTablePubkey) => {
    let lookupTableAccount;
    const startTime = Date.now();
    const TIMEOUT = 100000;
    let isLUTValid = false;

    while (Date.now() - startTime < TIMEOUT) {

        console.log("---- verifing lookup Table", _lookupTablePubkey)
        
        lookupTableAccount = (await SOLANA_CONNECTION.getAddressLookupTable(_lookupTablePubkey));
        
        if (lookupTableAccount.value && lookupTableAccount.value.state && lookupTableAccount.value.state.addresses.length > 0) {
            isLUTValid = true;
            console.log("--- Success! ---")
            console.log(`https://explorer.solana.com/address/${_lookupTablePubkey.toString()}/entries?cluster=mainnet`)
            return lookupTableAccount
        }
        await sleep(1000)
    }

    if (isLUTValid) {
        return lookupTableAccount;
    }

    return null;
}

