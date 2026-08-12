const ROLES = Object.freeze({
  CUSTOMER: 'customer',
  ASTROLOGER: 'astrologer',
  ADMIN: 'admin',
});

const PERMISSIONS = Object.freeze({
  MANAGE_USERS: 'manage_users',
  MANAGE_ASTROLOGERS: 'manage_astrologers',
  MANAGE_PRODUCTS: 'manage_products',
  MANAGE_ORDERS: 'manage_orders',
  MANAGE_WALLET: 'manage_wallet',
  MANAGE_AI: 'manage_ai',
  MANAGE_CMS: 'manage_cms',
  MANAGE_COUPONS: 'manage_coupons',
  MANAGE_PAYMENTS: 'manage_payments',
  VIEW_ANALYTICS: 'view_analytics',
  MANAGE_SETTINGS: 'manage_settings',
});

const WALLET_TX_TYPE = Object.freeze({
  CREDIT: 'credit',
  DEBIT: 'debit',
  REFUND: 'refund',
  RECHARGE: 'recharge',
  CHAT_DEDUCTION: 'chat_deduction',
  ORDER_PAYMENT: 'order_payment',
  POOJA_PAYMENT: 'pooja_payment',
  WITHDRAWAL: 'withdrawal',
  REFERRAL_BONUS: 'referral_bonus',
  COUPON_BONUS: 'coupon_bonus',
  ADMIN_ADJUSTMENT: 'admin_adjustment',
  EARNING: 'earning',
});

const CHAT_TYPE = Object.freeze({
  AI: 'ai',
  HUMAN: 'human',
});

const CHAT_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  ENDED: 'ended',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
});

const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  RETURN_REQUESTED: 'return_requested',
  RETURNED: 'returned',
  REFUNDED: 'refunded',
});

const ASTROLOGER_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
});

const KYC_STATUS = Object.freeze({
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

module.exports = {
  ROLES,
  PERMISSIONS,
  WALLET_TX_TYPE,
  CHAT_TYPE,
  CHAT_STATUS,
  ORDER_STATUS,
  ASTROLOGER_STATUS,
  KYC_STATUS,
};
