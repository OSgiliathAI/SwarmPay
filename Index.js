```javascript
require('dotenv').config();
const express = require('express');
const { 
  Connection, 
  PublicKey 
} = require('@solana/web3.js');
const { 
  getAssociatedTokenAddress, 
  TOKEN_PROGRAM_ID 
} = require('@solana/spl-token');
const bs58 = require('bs58');

const app = express();
app.use(express.json());

const connection = new Connection(
  process.env.SOLANA_RPC || 'https://api.devnet.solana.com',
  'confirmed' 
);

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MERCHANT_WALLET = new PublicKey(process.env.MERCHANT_WALLET || 'DefaultTestWalletPubkey');
const REQUIRED_AMOUNT = parseInt(process.env.REQUIRED_AMOUNT || 1000000);
const NONCE_STORE = new Map();

app.get('/api/swarm-data', async (req, res) => {
  const paymentHeader = req.get('X-PAYMENT');

  if (!paymentHeader) {
    return res.status(402).json({
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'solana',
        asset: USDC_MINT.toBase58(),
        payTo: MERCHANT_WALLET.toBase58(),
        maxAmountRequired: REQUIRED_AMOUNT.toString(),
        maxTimeoutSeconds: 60
      }]
    });
  }

  try {
    const payload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
    const { signature, from, amount, nonce } = payload;

    if (parseInt(amount) !== REQUIRED_AMOUNT) throw new Error('Incorrect payment amount');
    if (NONCE_STORE.has(nonce)) throw new Error('Replay attack detected');
    NONCE_STORE.set(nonce, true);

    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    if (!tx || tx.meta?.err) throw new Error('Transaction failed or not found');

    let paid = false;
    const instructions = tx.transaction.message.instructions;

    for (const ix of instructions) {
      if (ix.programId.toBase58() === TOKEN_PROGRAM_ID.toBase58() && ix.parsed?.type === 'transfer') {
        const dest = ix.parsed.info.destination;
        const src = ix.parsed.info.source;
        const amt = parseInt(ix.parsed.info.amount);

        const merchantATA = await getAssociatedTokenAddress(USDC_MINT, MERCHANT_WALLET);
        const payerATA = await getAssociatedTokenAddress(USDC_MINT, new PublicKey(from));

        if (dest === merchantATA.toBase58() && src === payerATA.toBase58() && amt === REQUIRED_AMOUNT) {
          paid = true;
          break;
        }
      }
    }

    if (!paid) throw new Error('No valid USDC transfer detected');

    res.json({
      data: {
        swarm_status: 'active',
        agents_online: 47,
        avg_temp_c: 22.5,
        avg_location_coords: [37.7749, -122.4194],
        collision_risk: 'LOW'
      },
      tx_signature: signature
    });

  } catch (error) {
    console.error('Verification Error:', error);
    res.status(402).json({ error: 'Payment failed', details: error.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'up', version: '1.0.0' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SlSwarmPay live on port ${PORT}`));
