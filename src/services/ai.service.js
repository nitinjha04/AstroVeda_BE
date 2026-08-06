const OpenAI = require('openai');
const config = require('../config');
const { Settings, AIChat, Message, ChatRoom, User } = require('../models');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { cacheGet, cacheSet } = require('../config/redis');
const aiStyleRules = require('../data/aiStyleRules');

let client = null;

const getClient = () => {
  const apiKey = config.openai.apiKey;
  if (!apiKey) return null;

  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: config.openai.baseURL,
      defaultHeaders: {
        'HTTP-Referer': config.appUrl || 'https://astroverse.app',
        'X-Title': config.appName || 'AstroVerse',
      },
    });
    logger.info(
      `AI client ready via ${config.openai.provider} · default model ${config.openai.defaultModel}`
    );
  }
  return client;
};

const getAiSettings = async () => {
  const cached = await cacheGet('settings:ai');
  if (cached && !config.openai.forceCheapModel) return cached;

  const doc = await Settings.findOne({ key: 'ai' });
  const defaults = {
    enabled: true,
    provider: config.openai.provider,
    model: config.openai.defaultModel,
    temperature: 0.65,
    pricePerMinute: config.wallet.defaultAiPricePerMinute,
    systemPrompt: aiStyleRules.systemPrompt,
    personality: 'wise_empathetic',
    maxTokens: Math.min(config.openai.maxTokens || 220, 220),
  };

  let value = { ...defaults, ...(doc?.value || {}) };

  if (config.openai.forceCheapModel) {
    value.model = config.openai.defaultModel;
    value.provider = config.openai.provider;
    value.maxTokens = Math.min(value.maxTokens || 220, 220);
    value.systemPrompt = aiStyleRules.systemPrompt;
  }

  await cacheSet('settings:ai', value, 120);
  return value;
};

const polishAiText = (raw) => {
  let text = String(raw || '').trim();
  if (!text) return 'Namaste. Could you share a bit more about what you need guidance on?';

  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/\*{3,}/g, '**')
    .replace(/\n{3,}/g, '\n\n');

  const maxLen = 700;
  if (text.length > maxLen) {
    const cut = text.slice(0, maxLen);
    const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
    text = `${cut.slice(0, lastBreak > 200 ? lastBreak + 1 : maxLen).trim()}…`;
  }

  return text;
};

const chatCompletion = async ({ messages, model, temperature, maxTokens }) => {
  const ai = getClient();
  if (!ai) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    return {
      content: `Namaste! (AI not configured). You asked: "${lastUser?.content || ''}". How can the stars support you today?`,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      model: model || 'stub',
    };
  }

  const resolvedModel =
    model || config.openai.defaultModel || 'google/gemma-4-26b-a4b-it:free';

  const systemMsgs = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');
  const finalMessages = [
    {
      role: 'system',
      content: [aiStyleRules.systemPrompt, ...systemMsgs.map((m) => m.content)]
        .filter(Boolean)
        .join('\n\n'),
    },
    ...nonSystem.slice(-12),
  ];

  try {
    const completion = await ai.chat.completions.create({
      model: resolvedModel,
      temperature: temperature ?? 0.65,
      max_tokens: Math.min(maxTokens || 220, 220),
      messages: finalMessages,
    });

    const choice = completion.choices?.[0]?.message || {};
    const raw =
      choice.content ||
      choice.reasoning ||
      (Array.isArray(choice.content) ? choice.content.map((c) => c.text || '').join('') : '') ||
      '';

    return {
      content: polishAiText(raw),
      usage: completion.usage || {},
      model: completion.model || resolvedModel,
    };
  } catch (err) {
    logger.error(`OpenRouter AI error: ${err.message}`);
    if (/404|unavailable/i.test(err.message) && resolvedModel !== 'openrouter/free') {
      try {
        const fallback = await ai.chat.completions.create({
          model: 'openrouter/free',
          temperature: temperature ?? 0.65,
          max_tokens: 180,
          messages: finalMessages,
        });
        const msg = fallback.choices?.[0]?.message?.content || '';
        return {
          content: polishAiText(msg),
          usage: fallback.usage || {},
          model: fallback.model || 'openrouter/free',
        };
      } catch (e2) {
        logger.error(`OpenRouter free fallback failed: ${e2.message}`);
      }
    }
    if (err.status === 429 || /rate|quota/i.test(err.message)) {
      throw new AppError('AI is busy (free model rate limit). Wait a moment and try again.', 503);
    }
    throw new AppError(`AI service unavailable: ${err.message}`, 503);
  }
};

const generateAiReply = async (chatRoomId, customerMessage) => {
  const settings = await getAiSettings();
  if (!settings.enabled) throw new AppError('AI chat is currently disabled', 503);

  const [aiChat, room] = await Promise.all([
    AIChat.findOne({ chatRoom: chatRoomId }),
    ChatRoom.findById(chatRoomId).select('customer aiConfig aiAstrologer').lean(),
  ]);
  if (!aiChat) throw new AppError('AI chat session not found', 404);

  const history = await Message.find({
    chatRoom: chatRoomId,
    senderRole: { $in: ['customer', 'ai'] },
  })
    .sort({ createdAt: 1 })
    .limit(12);

  let birthContext = '';
  if (room?.customer) {
    const customer = await User.findById(room.customer)
      .select('name gender dateOfBirth birthTime birthPlace privacy')
      .lean();
    if (customer?.privacy?.shareBirthDetailsWithAi) {
      const parts = [];
      if (customer.name) parts.push(`Name: ${customer.name}`);
      if (customer.gender) parts.push(`Gender: ${customer.gender}`);
      if (customer.dateOfBirth) {
        parts.push(`Date of birth: ${new Date(customer.dateOfBirth).toISOString().slice(0, 10)}`);
      }
      if (customer.birthTime) parts.push(`Birth time: ${customer.birthTime}`);
      if (customer.birthPlace) parts.push(`Birth place: ${customer.birthPlace}`);
      if (parts.length) {
        birthContext = [
          'The seeker shared their birth profile (use only if relevant; do not invent missing details):',
          parts.join('; '),
        ].join(' ');
      }
    }
  }

  const personaPrompt =
    room?.aiConfig?.systemPrompt ||
    aiChat.systemPrompt ||
    aiStyleRules.systemPrompt;

  const messages = [
    { role: 'system', content: personaPrompt },
    ...(birthContext ? [{ role: 'system', content: birthContext }] : []),
    ...history.map((m) => ({
      role: m.senderRole === 'customer' ? 'user' : 'assistant',
      content: m.content,
    })),
  ];

  if (!messages.some((m) => m.role === 'user' && m.content === customerMessage)) {
    messages.push({ role: 'user', content: customerMessage });
  }

  const result = await chatCompletion({
    messages,
    model: config.openai.forceCheapModel
      ? config.openai.defaultModel
      : aiChat.model || settings.model,
    temperature: 0.65,
    maxTokens: 200,
  });

  aiChat.promptTokens += result.usage.prompt_tokens || 0;
  aiChat.completionTokens += result.usage.completion_tokens || 0;
  aiChat.totalTokens += result.usage.total_tokens || 0;
  aiChat.messageCount += 1;
  aiChat.model = result.model || aiChat.model;
  await aiChat.save();

  return result;
};

const updateAiSettings = async (updates, adminId) => {
  const current = await getAiSettings();
  const merged = { ...current, ...updates };

  if (config.openai.forceCheapModel) {
    merged.model = config.openai.defaultModel;
    merged.maxTokens = Math.min(merged.maxTokens || 220, 220);
    merged.systemPrompt = aiStyleRules.systemPrompt;
  }

  await Settings.findOneAndUpdate(
    { key: 'ai' },
    {
      key: 'ai',
      value: merged,
      group: 'ai',
      updatedBy: adminId,
      description: 'AI chat configuration (OpenRouter)',
    },
    { upsert: true, new: true }
  );
  const { cacheDel } = require('../config/redis');
  await cacheDel('settings:ai');
  return merged;
};

module.exports = {
  getAiSettings,
  chatCompletion,
  generateAiReply,
  updateAiSettings,
  aiStyleRules,
};
