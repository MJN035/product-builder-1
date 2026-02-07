const express = require('express');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const port = 3000;

// IMPORTANT: Make sure to set the GEMINI_API_KEY environment variable.
const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

app.use(express.static('.'));

app.get('/api/song-info', async (req, res) => {
  const songTitle = req.query.songTitle;

  if (!songTitle) {
    return res.status(400).send({ error: 'songTitle is required' });
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const prompt = `What is the highest note of the song "${songTitle}"? Please provide the note in MIDI number format.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // The response from Gemini might be a string like "72" or "The highest note is 72".
    // We need to parse this to get the MIDI number.
    const midiNumberMatch = text.match(/\d+/);
    if (midiNumberMatch) {
        const midiNumber = parseInt(midiNumberMatch[0]);
        res.send({ title: songTitle, maxNote: midiNumber, source: 'Gemini API' });
    } else {
        res.status(500).send({ error: 'Could not parse the highest note from the Gemini API response.' });
    }

  } catch (error) {
    console.error(error);
    res.status(500).send({ error: `Failed to get song info from Gemini API: ${error.message}` });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
