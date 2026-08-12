const storeService = require('../../services/store.service');
const { User, Product } = require('../../models');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

const listProducts = asyncHandler(async (req, res) => {
  const result = await storeService.listProducts(req.query);
  return success(res, { data: result.items, meta: result.meta });
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await storeService.getProductBySlug(req.params.slug);
  return success(res, { data: product });
});

const getCart = asyncHandler(async (req, res) => {
  const cart = await storeService.getOrCreateCart(req.user._id);
  return success(res, { data: cart });
});

const addToCart = asyncHandler(async (req, res) => {
  const cart = await storeService.addToCart(req.user._id, req.body);
  return success(res, { message: 'Added to cart', data: cart });
});

const updateCartItem = asyncHandler(async (req, res) => {
  const cart = await storeService.updateCartItem(req.user._id, req.params.itemId, Number(req.body.quantity));
  return success(res, { data: cart });
});

const clearCartHandler = asyncHandler(async (req, res) => {
  await storeService.clearCart(req.user._id);
  const cart = await storeService.getOrCreateCart(req.user._id);
  return success(res, { message: 'Cart cleared', data: cart });
});

const checkout = asyncHandler(async (req, res) => {
  const data = await storeService.checkout(req.user._id, req.body);
  return created(res, { message: 'Complete payment to place your order', data });
});

const myOrders = asyncHandler(async (req, res) => {
  const result = await storeService.listOrders(req.user._id, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
  });
  return success(res, { data: result.items, meta: result.meta });
});

const toggleWishlist = asyncHandler(async (req, res) => {
  const productId = req.body.productId;
  const product = await Product.findById(productId);
  if (!product) throw new AppError('Product not found', 404);

  const user = await User.findById(req.user._id);
  const idx = user.wishlist.findIndex((id) => id.toString() === productId);
  if (idx >= 0) user.wishlist.splice(idx, 1);
  else user.wishlist.push(productId);
  await user.save();

  return success(res, {
    message: idx >= 0 ? 'Removed from wishlist' : 'Added to wishlist',
    data: { wishlist: user.wishlist },
  });
});

const getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('wishlist');
  return success(res, { data: user.wishlist });
});

module.exports = {
  listProducts,
  getProduct,
  getCart,
  addToCart,
  updateCartItem,
  clearCart: clearCartHandler,
  checkout,
  myOrders,
  toggleWishlist,
  getWishlist,
};
