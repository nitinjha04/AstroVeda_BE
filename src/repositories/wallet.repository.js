const { Wallet, WalletTransaction } = require('../models');

class WalletRepository {
  findByUser(userId, session = null) {
    return Wallet.findOne({ user: userId }).session(session);
  }

  create(data, session = null) {
    return Wallet.create([data], { session }).then((r) => r[0]);
  }

  listTransactions(userId, { page = 1, limit = 20, type } = {}) {
    const filter = { user: userId };
    if (type) filter.type = type;
    const skip = (page - 1) * limit;
    return Promise.all([
      WalletTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      WalletTransaction.countDocuments(filter),
    ]).then(([items, total]) => ({
      items,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    }));
  }
}

module.exports = new WalletRepository();
