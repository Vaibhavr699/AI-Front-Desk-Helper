const express = require('express');
const OpenAI = require('openai');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Health Check (for Render)
app.get('/health', (req, res) => {
  res.send('OK');
});

// Initial Call Entry
app.post('/twilio-voice', (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.send(`
    <Response>
      <Gather input="speech" action="/process-speech" method="POST" timeout="3">
        <Say voice="alice">
          Thank you for calling Gladiators Painting.
          How can I help you today?
        </Say>
      </Gather>
      <Say>I didn't hear anything. Please call again.</Say>
    </Response>
  `);
});

// Process Caller Speech with OpenAI
app.post('/process-speech', async (req, res) => {
  const userSpeech = req.body.SpeechResult || "No speech detected";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
          You are a professional AI receptionist for a painting company.
          Your goal is to:
          - Gather caller name
          - Gather phone number
          - Gather address
          - Determine if interior or exterior
          - Offer to schedule a free estimate
          Be friendly, clear, and concise.
          `
        },
        {
          role: "user",
          content: userSpeech
        }
      ]
    });

    const aiResponse = completion.choices[0].message.content;

    res.set('Content-Type', 'text/xml');
    res.send(`
      <Response>
        <Say voice="alice">${aiResponse}</Say>
        <Gather input="speech" action="/process-speech" method="POST" timeout="3"/>
      </Response>
    `);

  } catch (error) {
    console.error(error);
    res.set('Content-Type', 'text/xml');
    res.send(`
      <Response>
        <Say>Sorry, something went wrong. Please try again later.</Say>
      </Response>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
