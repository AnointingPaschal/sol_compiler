require('dotenv').config();
const express = require('express');
const cors = require('cors');
const solc = require('solc');
const { ethers } = require('ethers');

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS and increase JSON payload limit for large smart contracts
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─────────────────────────────────────────────────────────
// 1. SOLIDITY COMPILER ROUTE
// ─────────────────────────────────────────────────────────
app.post('/compile', (req, res) => {
    try {
        const { source, contract_name } = req.body;

        if (!source) {
            return res.status(400).json({ success: false, errors: ['No source code provided'] });
        }

        const name = contract_name || 'Contract';

        // Format the input for the solc compiler
        const input = {
            language: 'Solidity',
            sources: {
                [`${name}.sol`]: {
                    content: source
                }
            },
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 200
                },
                outputSelection: {
                    '*': {
                        '*': ['abi', 'evm.bytecode']
                    }
                }
            }
        };

        // Compile the code
        const output = JSON.parse(solc.compile(JSON.stringify(input)));

        // Handle Compilation Errors
        if (output.errors) {
            const fatalErrors = output.errors.filter(e => e.severity === 'error');
            if (fatalErrors.length > 0) {
                return res.status(400).json({
                    success: false,
                    errors: fatalErrors.map(e => e.formattedMessage)
                });
            }
        }

        // Format the output to match Glow IDE's expectations
        const contracts = {};
        for (const [file, fileContracts] of Object.entries(output.contracts || {})) {
            for (const [cname, c] of Object.entries(fileContracts)) {
                contracts[cname] = {
                    name: cname,
                    abi: c.abi,
                    bytecode: '0x' + c.evm.bytecode.object
                };
            }
        }

        return res.json({ success: true, contracts });

    } catch (error) {
        console.error("Compiler Error:", error);
        return res.status(500).json({ success: false, errors: ['Internal server error during compilation'] });
    }
});

// ─────────────────────────────────────────────────────────
// 2. ARC TESTNET FAUCET ROUTE
// ─────────────────────────────────────────────────────────
const ARC_RPC = 'https://rpc.testnet.arc.network';
const USDC_ADDR = '0x3600000000000000000000000000000000000000';
const FAUCET_AMOUNT = "5.0"; // Dispense 5 USDC per request

// Initialize Ethers Wallet (if private key is provided in .env)
let usdcContract = null;
if (process.env.FAUCET_PRIVATE_KEY) {
    const provider = new ethers.providers.JsonRpcProvider(ARC_RPC);
    const wallet = new ethers.Wallet(process.env.FAUCET_PRIVATE_KEY, provider);
    const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
    usdcContract = new ethers.Contract(USDC_ADDR, erc20Abi, wallet);
}

app.post('/api/faucet', async (req, res) => {
    try {
        const { address, secret_key } = req.body;

        // Ensure the server has the private key configured
        if (!usdcContract) {
            return res.status(500).json({ success: false, error: 'Faucet wallet is not configured on the server.' });
        }

        // Authenticate that this request came from your PHP server
        if (secret_key !== process.env.GLOW_FAUCET_SECRET) {
            return res.status(401).json({ success: false, error: 'Unauthorized Faucet Request' });
        }

        // Validate the destination address
        if (!address || !ethers.utils.isAddress(address)) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }

        console.log(`Dispensing ${FAUCET_AMOUNT} USDC to ${address}...`);

        // Format amount (Arc USDC uses 6 decimals)
        const amount = ethers.utils.parseUnits(FAUCET_AMOUNT, 6);

        // Send the Transaction
        const tx = await usdcContract.transfer(address, amount);
        
        // Return immediately while the network mines the transaction
        return res.json({ 
            success: true, 
            txHash: tx.hash,
            message: `Successfully sent ${FAUCET_AMOUNT} USDC` 
        });

    } catch (error) {
        console.error("Faucet Error:", error);
        return res.status(500).json({ success: false, error: 'Faucet transaction failed. The treasury may be empty or the network is congested.' });
    }
});

// ─────────────────────────────────────────────────────────
// 3. HEALTH CHECK
// ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.send('Glow IDE Microservice (Compiler & Faucet API) is running smoothly.');
});

app.listen(port, () => {
    console.log(`Microservice listening on port ${port}`);
});
