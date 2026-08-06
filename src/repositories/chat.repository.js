const { ChatRoom, Message } = require('../models');

class ChatRepository {
  findRoomById(id) {
    return ChatRoom.findById(id);
  }

  findActiveForCustomer(customerId) {
    return ChatRoom.findOne({
      customer: customerId,
      status: { $in: ['pending', 'active'] },
    });
  }

  createRoom(data) {
    return ChatRoom.create(data);
  }

  getMessages(chatRoomId, { page = 1, limit = 50 } = {}) {
    const skip = (page - 1) * limit;
    return Promise.all([
      Message.find({ chatRoom: chatRoomId }).sort({ createdAt: 1 }).skip(skip).limit(limit),
      Message.countDocuments({ chatRoom: chatRoomId }),
    ]);
  }

  createMessage(data) {
    return Message.create(data);
  }
}

module.exports = new ChatRepository();
