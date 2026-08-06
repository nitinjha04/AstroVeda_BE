const mongoose = require('mongoose');
const { Wallet, WalletTransaction, Notification } = require('../models');
const AppError = require('../utils/AppError');
const { WALLET_TX_TYPE } = require('../utils/constants');
const logger = require('../utils/logger');

const useTransactions = () => process.env.WALLET_USE_TRANSACTIONS === 'true';

const getOrCreateWallet = async (userId, session = null) => {
  let q = Wallet.findOne({ user: userId });
  if (session) q = q.session(session);
  let wallet = await q;
  if (!wallet) {
    if (session) {
      const created = await Wallet.create([{ user: userId, balance: 0 }], { session });
      wallet = created[0];
    } else {
      wallet = await Wallet.create({ user: userId, balance: 0 });
    }
  }
  return wallet;
};

const creditSimple = async ({
  userId,
  amount,
  type,
  description,
  reference,
  referenceModel,
  referenceId,
  metadata,
  performedBy,
}) => {
  let wallet = await Wallet.findOne({ user: userId });
  if (!wallet) wallet = await Wallet.create({ user: userId, balance: 0 });
  if (wallet.isLocked) throw new AppError('Wallet is locked', 403);

  const balanceBefore = wallet.balance;
  wallet.balance = Number((wallet.balance + amount).toFixed(2));
  wallet.lifetimeCredit = Number((wallet.lifetimeCredit + amount).toFixed(2));
  await wallet.save();

  const tx = await WalletTransaction.create({
    wallet: wallet._id,
    user: userId,
    type,
    amount,
    balanceBefore,
    balanceAfter: wallet.balance,
    direction: 'credit',
    reference,
    referenceModel,
    referenceId,
    description,
    metadata,
    performedBy,
    status: 'completed',
  });

  Notification.create({
    user: userId,
    title: 'Wallet Credited',
    body: `₹${amount} credited. Balance: ₹${wallet.balance}`,
    type: 'wallet',
    data: { transactionId: tx._id, balance: wallet.balance },
  }).catch(() => {});

  return { wallet, transaction: tx };
};

const debitSimple = async ({
  userId,
  amount,
  type,
  description,
  reference,
  referenceModel,
  referenceId,
  metadata,
  performedBy,
  allowPartial = false,
}) => {
  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet) throw new AppError('Wallet not found', 404);
  if (wallet.isLocked) throw new AppError('Wallet is locked', 403);

  let debitAmount = amount;
  if (wallet.balance < amount) {
    if (!allowPartial || wallet.balance <= 0) {
      throw new AppError('Insufficient wallet balance', 402);
    }
    debitAmount = wallet.balance;
  }

  const balanceBefore = wallet.balance;
  wallet.balance = Number((wallet.balance - debitAmount).toFixed(2));
  wallet.lifetimeDebit = Number((wallet.lifetimeDebit + debitAmount).toFixed(2));
  await wallet.save();

  const tx = await WalletTransaction.create({
    wallet: wallet._id,
    user: userId,
    type,
    amount: debitAmount,
    balanceBefore,
    balanceAfter: wallet.balance,
    direction: 'debit',
    reference,
    referenceModel,
    referenceId,
    description,
    metadata,
    performedBy,
    status: 'completed',
  });

  return { wallet, transaction: tx, debitedAmount: debitAmount };
};

const credit = async ({
  userId,
  amount,
  type = WALLET_TX_TYPE.CREDIT,
  description = '',
  reference = null,
  referenceModel = null,
  referenceId = null,
  metadata = {},
  performedBy = null,
  session: externalSession = null,
}) => {
  if (amount <= 0) throw new AppError('Credit amount must be positive', 400);

  // Standalone / memory Mongo do not support multi-doc transactions unless replica set
  if (!externalSession && !useTransactions()) {
    return creditSimple({
      userId,
      amount,
      type,
      description,
      reference,
      referenceModel,
      referenceId,
      metadata,
      performedBy,
    });
  }

  const session = externalSession || (await mongoose.startSession());
  const ownsSession = !externalSession;
  if (ownsSession) session.startTransaction();

  try {
    const wallet = await getOrCreateWallet(userId, session);
    if (wallet.isLocked) throw new AppError('Wallet is locked', 403);

    const balanceBefore = wallet.balance;
    wallet.balance = Number((wallet.balance + amount).toFixed(2));
    wallet.lifetimeCredit = Number((wallet.lifetimeCredit + amount).toFixed(2));
    await wallet.save({ session });

    const [tx] = await WalletTransaction.create(
      [
        {
          wallet: wallet._id,
          user: userId,
          type,
          amount,
          balanceBefore,
          balanceAfter: wallet.balance,
          direction: 'credit',
          reference,
          referenceModel,
          referenceId,
          description,
          metadata,
          performedBy,
          status: 'completed',
        },
      ],
      { session }
    );

    if (ownsSession) await session.commitTransaction();

    Notification.create({
      user: userId,
      title: 'Wallet Credited',
      body: `₹${amount} credited. Balance: ₹${wallet.balance}`,
      type: 'wallet',
      data: { transactionId: tx._id, balance: wallet.balance },
    }).catch(() => {});

    return { wallet, transaction: tx };
  } catch (err) {
    if (ownsSession) {
      try {
        await session.abortTransaction();
      } catch {
        /* ignore */
      }
    }
    // Fallback when server is not a replica set
    if (!externalSession && /replica set|Transaction numbers/i.test(err.message || '')) {
      logger.warn('Wallet credit falling back to non-transactional path');
      return creditSimple({
        userId,
        amount,
        type,
        description,
        reference,
        referenceModel,
        referenceId,
        metadata,
        performedBy,
      });
    }
    throw err;
  } finally {
    if (ownsSession) session.endSession();
  }
};

const debit = async ({
  userId,
  amount,
  type = WALLET_TX_TYPE.DEBIT,
  description = '',
  reference = null,
  referenceModel = null,
  referenceId = null,
  metadata = {},
  performedBy = null,
  session: externalSession = null,
  allowPartial = false,
}) => {
  if (amount <= 0) throw new AppError('Debit amount must be positive', 400);

  if (!externalSession && !useTransactions()) {
    return debitSimple({
      userId,
      amount,
      type,
      description,
      reference,
      referenceModel,
      referenceId,
      metadata,
      performedBy,
      allowPartial,
    });
  }

  const session = externalSession || (await mongoose.startSession());
  const ownsSession = !externalSession;
  if (ownsSession) session.startTransaction();

  try {
    const wallet = await Wallet.findOne({ user: userId }).session(session);
    if (!wallet) throw new AppError('Wallet not found', 404);
    if (wallet.isLocked) throw new AppError('Wallet is locked', 403);

    let debitAmount = amount;
    if (wallet.balance < amount) {
      if (!allowPartial || wallet.balance <= 0) {
        throw new AppError('Insufficient wallet balance', 402);
      }
      debitAmount = wallet.balance;
    }

    const balanceBefore = wallet.balance;
    wallet.balance = Number((wallet.balance - debitAmount).toFixed(2));
    wallet.lifetimeDebit = Number((wallet.lifetimeDebit + debitAmount).toFixed(2));
    await wallet.save({ session });

    const [tx] = await WalletTransaction.create(
      [
        {
          wallet: wallet._id,
          user: userId,
          type,
          amount: debitAmount,
          balanceBefore,
          balanceAfter: wallet.balance,
          direction: 'debit',
          reference,
          referenceModel,
          referenceId,
          description,
          metadata,
          performedBy,
          status: 'completed',
        },
      ],
      { session }
    );

    if (ownsSession) await session.commitTransaction();
    return { wallet, transaction: tx, debitedAmount: debitAmount };
  } catch (err) {
    if (ownsSession) {
      try {
        await session.abortTransaction();
      } catch {
        /* ignore */
      }
    }
    if (!externalSession && /replica set|Transaction numbers/i.test(err.message || '')) {
      logger.warn('Wallet debit falling back to non-transactional path');
      return debitSimple({
        userId,
        amount,
        type,
        description,
        reference,
        referenceModel,
        referenceId,
        metadata,
        performedBy,
        allowPartial,
      });
    }
    throw err;
  } finally {
    if (ownsSession) session.endSession();
  }
};

const getBalance = async (userId) => {
  const wallet = await getOrCreateWallet(userId);
  return wallet;
};

const getTransactions = async (userId, { page = 1, limit = 20, type } = {}) => {
  const filter = { user: userId };
  if (type) filter.type = type;
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    WalletTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    WalletTransaction.countDocuments(filter),
  ]);
  return {
    items,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

const adminAdjust = async ({ userId, amount, direction, reason, adminId }) => {
  if (direction === 'credit') {
    return credit({
      userId,
      amount,
      type: WALLET_TX_TYPE.ADMIN_ADJUSTMENT,
      description: reason || 'Admin credit adjustment',
      performedBy: adminId,
      referenceModel: 'Admin',
    });
  }
  return debit({
    userId,
    amount,
    type: WALLET_TX_TYPE.ADMIN_ADJUSTMENT,
    description: reason || 'Admin debit adjustment',
    performedBy: adminId,
    referenceModel: 'Admin',
  });
};

logger.info('Wallet service loaded');

module.exports = {
  getOrCreateWallet,
  credit,
  debit,
  getBalance,
  getTransactions,
  adminAdjust,
};
