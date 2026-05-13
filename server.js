const express = require('express');
const cors = require('cors');
const solc = require('solc');

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS and increase JSON payload limit for large smart contracts
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
        console.error("Server Error:", error);
        return res.status(500).json({ success: false, errors: ['Internal server error during compilation'] });
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Glow IDE Compiler API is running.');
});

app.listen(port, () => {
    console.log(`Compiler API listening on port ${port}`);
});
