const dotenv = require('dotenv');
const VisitDay = require('../../models/VisitDay');
const VisitLog = require('../../models/VisitLog');
const connectDb = require('../../db');

dotenv.config();

let dbConnected = false;

async function ensureDB() {
  if (!dbConnected) {
    await connectDb();
    dbConnected = true;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };

  try {
    await ensureDB();

    const path = event.path;
    const method = event.httpMethod;

    // Get visit data
    if (path === '/data' && method === 'GET') {
      const days = await VisitDay.find().sort({ day: -1 }).limit(90).lean();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          visits: days.map(d => ({ day: d.day, count: d.count })),
        }),
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not Found' }),
    };

  } catch (err) {
    console.error('Data Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', message: err.message }),
    };
  }
};
