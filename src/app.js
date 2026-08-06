const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');
const config = require('./config');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const { globalLimiter } = require('./middlewares/rateLimiter');
const logger = require('./utils/logger');

const app = express();

// Required behind Render reverse proxy (rate-limit, IP, secure cookies)
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = config.corsOrigins;

app.use(
  cors({
    origin(origin, callback) {
      // Cron keep-alive, Postman, mobile: no Origin header
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes('*') ||
        process.env.CORS_RELAXED === 'true'
      ) {
        return callback(null, true);
      }
      // Log and still allow if only Hostinger domain mismatch during setup
      if (process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);
app.options('*', cors());

app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());

app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    const sanitize = (obj) => {
      Object.keys(obj).forEach((k) => {
        if (typeof obj[k] === 'string') {
          obj[k] = obj[k].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        } else if (typeof obj[k] === 'object' && obj[k] !== null) sanitize(obj[k]);
      });
    };
    sanitize(req.body);
  }
  next();
});

if (config.env !== 'test') {
  app.use(
    morgan(config.env === 'production' ? 'combined' : 'dev', {
      stream: { write: (msg) => logger.http?.(msg.trim()) || logger.info(msg.trim()) },
    })
  );
}

// Ultra-light root + keep-alive BEFORE rate limiter (external cron must not 429)
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: config.appName,
    status: 'ok',
    env: config.env,
    health: '/api/v1/health',
    ping: '/api/v1/ping',
  });
});

app.get('/api/v1/ping', (req, res) => {
  res.status(200).type('text/plain').send('pong');
});

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'AstroVerse API healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use(globalLimiter);
app.use('/api/v1', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
