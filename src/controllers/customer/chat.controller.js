const chatService = require('../../services/chat.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../utils/apiResponse');

const startAi = asyncHandler(async (req, res) => {
  const aiAstrologerId = req.body.aiAstrologerId || req.body.astrologerId;
  const data = await chatService.startAiChat(req.user._id, aiAstrologerId);
  const io = req.app.get('io');
  const roomId = data.room?._id || data.room?.id;
  if (io?.startBillingTimer && roomId) {
    io.startBillingTimer(String(roomId));
  }
  return created(res, { message: 'AI chat started', data });
});

const requestChat = asyncHandler(async (req, res) => {
  const room = await chatService.requestHumanChat(req.user._id, req.body.astrologerId);
  return created(res, { message: 'Chat request sent', data: room });
});

/** Save customer message only (fast) — AI is a separate call */
const sendMessage = asyncHandler(async (req, res) => {
  const skipAi = req.body.skipAi !== false; // default: save only for snappy delivery status
  const data = await chatService.sendMessage({
    chatRoomId: req.params.id,
    senderId: req.user._id,
    senderRole: 'customer',
    content: req.body.content,
    contentType: req.body.contentType,
    mediaUrl: req.body.mediaUrl,
    skipAi,
  });
  return success(res, { data });
});

/** Generate AI reply after message was saved */
const aiReply = asyncHandler(async (req, res) => {
  const reply = await chatService.generateAiReplyForRoom(
    req.params.id,
    req.user._id,
    req.body.content
  );
  return success(res, { data: { aiReply: reply } });
});

const endChat = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  const room = await chatService.endChat(req.params.id, {
    endedBy: 'customer',
    endReason: req.body.reason || 'Ended by customer',
    io,
  });
  return success(res, { message: 'Chat ended', data: room });
});

/** End all active sessions (page refresh / reconnect cleanup) */
const endActiveChats = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  const ended = await chatService.endActiveChatsForUser(req.user._id, {
    io,
    endReason: req.body.reason || 'Session ended on page refresh / reopen',
  });
  return success(res, {
    message: ended.length ? `Closed ${ended.length} active session(s)` : 'No active sessions',
    data: { count: ended.length, rooms: ended },
  });
});

const getActiveChat = asyncHandler(async (req, res) => {
  const room = await chatService.getActiveChatForUser(req.user._id, req.query.type || null);
  return success(res, { data: room });
});

/** Open past AI chat (history view) */
const openAi = asyncHandler(async (req, res) => {
  const room = await chatService.openAiChat(req.user._id, req.params.id);
  return success(res, { data: room });
});

/** Continue an ended AI chat (starts billing again) */
const resumeAi = asyncHandler(async (req, res) => {
  const room = await chatService.resumeAiChat(req.user._id, req.params.id);
  const io = req.app.get('io');
  const roomId = room?._id || room?.id;
  if (io?.startBillingTimer && roomId) {
    io.startBillingTimer(String(roomId));
  }
  return success(res, { message: 'Chat continued', data: room });
});

const getMessages = asyncHandler(async (req, res) => {
  const result = await chatService.getMessages(req.params.id, req.user._id, {
    limit: Number(req.query.limit) || 40,
    before: req.query.before || null,
  });
  return success(res, { data: result });
});

const history = asyncHandler(async (req, res) => {
  const result = await chatService.getChatHistory(req.user._id, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 30,
    type: req.query.type,
    aiAstrologerId: req.query.aiAstrologerId || null,
  });
  return success(res, { data: result.items, meta: result.meta });
});

module.exports = {
  startAi,
  requestChat,
  sendMessage,
  aiReply,
  endChat,
  endActiveChats,
  getActiveChat,
  openAi,
  resumeAi,
  getMessages,
  history,
};
