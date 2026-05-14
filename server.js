require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));
const transactions = {};

async function getToken() {
  const auth = Buffer.from(`${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', { headers: { Authorization: `Basic ${auth}` } });
  return res.data.access_token;
}

app.post('/send', async (req, res) => {
  const { sender, recipient, amount } = req.body;
  if (!sender || !recipient || !amount) return res.status(400).json({ error: 'All fields required.' });
  const formatPhone = (n) => { const c = n.replace(/\D/g,''); return c.startsWith('254') ? c : '254'+c.replace(/^0/,''); };
  const senderPhone = formatPhone(sender);
  const recipientPhone = formatPhone(recipient);
  const amountInt = Math.ceil(parseFloat(amount));
  try {
    const token = await getToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
    const password = Buffer.from(`${process.env.SHORTCODE}${process.env.PASSKEY}${timestamp}`).toString('base64');
    const payload = {
      BusinessShortCode: process.env.SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amountInt,
      PartyA: senderPhone,
      PartyB: process.env.SHORTCODE,
      PhoneNumber: senderPhone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: recipientPhone,
      TransactionDesc: `Send KES ${amountInt} to ${recipientPhone}`
    };
    const stkRes = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', payload, { headers: { Authorization: `Bearer ${token}` } });
    console.log('STK Push success:', stkRes.data);
    const id = stkRes.data.CheckoutRequestID;
    transactions[id] = { status: 'pending', sender: senderPhone, recipient: recipientPhone, amount: amountInt };
    return res.json({ success: true, message: `STK Push sent to ${sender}.`, checkoutRequestId: id });
  } catch (err) {
    console.error('STK Error:', err.response?.data || err.message);
    return res.status(500).json({ error: JSON.stringify(err.response?.data) || err.message });
  }
});

app.post('/callback', (req, res) => {
  console.log('Callback received:', JSON.stringify(req.body));
  const body = req.body?.Body?.stkCallback;
  if (!body) return res.json({ ResultCode: 0, ResultDesc: 'OK' });
  const id = body.CheckoutRequestID;
  if (body.ResultCode === 0) {
    const items = body.CallbackMetadata?.Item || [];
    const get = (name) => items.find(i => i.Name === name)?.Value;
    transactions[id] = { status: 'success', amount: get('Amount'), receipt: get('MpesaReceiptNumber'), date: get('TransactionDate'), phone: get('PhoneNumber') };
  } else {
    transactions[id] = { status: 'failed', reason: body.ResultDesc };
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

app.get('/status/:id', (req, res) => {
  res.json(transactions[req.params.id] || { status: 'pending' });
});

app.listen(process.env.PORT || 3000, () => console.log(`M-PESA server running on port ${process.env.PORT || 3000}`));
