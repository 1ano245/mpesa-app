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
  console.log("--- Generating Token ---");
  const auth = Buffer.from(`${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`).toString('base64');
  try {
    const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', { 
      headers: { Authorization: `Basic ${auth}` } 
    });
    console.log("Token Generated Successfully");
    return res.data.access_token;
  } catch (error) {
    console.error("Token Error:", error.response ? error.response.data : error.message);
    throw error;
  }
}

app.post('/send', async (req, res) => {
  const { sender, recipient, amount } = req.body;
  
  const formatPhone = (n) => { 
    const c = n.replace(/\D/g,''); 
    return c.startsWith('254') ? c : '254' + c.replace(/^0/,''); 
  };

  const senderPhone = formatPhone(sender);
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
      AccountReference: "RenderTest",
      TransactionDesc: "Debugging Mpesa"
    };

    console.log("--- Sending STK Push Payload ---");
    console.log(JSON.stringify(payload, null, 2));

    const stkRes = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', payload, { 
      headers: { Authorization: `Bearer ${token}` } 
    });

    console.log("Safaricom Response:", stkRes.data);

    const id = stkRes.data.CheckoutRequestID;
    transactions[id] = { status: 'pending', sender: senderPhone, amount: amountInt };
    return res.json({ success: true, checkoutRequestId: id });

  } catch (err) {
    const errorData = err.response ? err.response.data : err.message;
    console.error('--- DETAILED ERROR LOG ---');
    console.error(JSON.stringify(errorData, null, 2));
    return res.status(500).json({ error: errorData.errorMessage || "Check Render Logs for details" });
  }
});

app.post('/callback', (req, res) => {
  console.log("--- Callback Received ---");
  console.log(JSON.stringify(req.body, null, 2));
  const body = req.body?.Body?.stkCallback;
  if (!body) return res.json({ ResultCode: 0, ResultDesc: 'OK' });
  
  const id = body.CheckoutRequestID;
  if (body.ResultCode === 0) {
    const items = body.CallbackMetadata?.Item || [];
    transactions[id] = { 
      status: 'success', 
      receipt: items.find(i => i.Name === 'MpesaReceiptNumber')?.Value 
    };
  } else {
    transactions[id] = { status: 'failed', reason: body.ResultDesc };
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

app.get('/status/:id', (req, res) => {
  res.json(transactions[req.params.id] || { status: 'pending' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`M-PESA debug server running on port ${PORT}`));
