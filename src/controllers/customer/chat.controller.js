const chatService = require('../../services/chat.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../utils/apiResponse');

const startAi = asyncHandler(async (req, res) => {
  const room = await chatService.startAiChat(req.user._id);
  return created(res, { message: 'AI chat started', data: room });
});

const requestChat = asyncHandler(async (req, res) => {
  const room = await chatService.requestHumanChat(req.user._id, req.body.astrologerId);
  return created(res, { message: 'Chat request sent', data: room });
});

const sendMessage = asyncHandler(async (req, res) => {
  const data = await chatService.sendMessage({
    chatRoomId: req.params.id,
    senderId: req.user._id,
    senderRole: 'customer',
    content: req.body.content,
    contentType: req.body.contentType,
    mediaUrl: req.body.mediaUrl,
  });
  return success(res, { data });
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

const getMessages = asyncHandler(async (req, res) => {
  const result = await chatService.getMessages(req.params.id, req.user._id, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 50,
  });
  return success(res, { data: result });
});

const history = asyncHandler(async (req, res) => {
  const result = await chatService.getChatHistory(req.user._id, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
    type: req.query.type,
  });
  return success(res, { data: result.items, meta: result.meta });
});

module.exports = { startAi, requestChat, sendMessage, endChat, getMessages, history };
