const poojaService = require('../../services/pooja.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../utils/apiResponse');

const list = asyncHandler(async (req, res) => {
  const data = await poojaService.listPoojas({
    search: req.query.search,
    category: req.query.category,
    page: req.query.page,
    limit: req.query.limit,
  });
  return success(res, { data: data.items, meta: data.meta });
});

const getBySlug = asyncHandler(async (req, res) => {
  const data = await poojaService.getPoojaBySlug(req.params.slug);
  return success(res, { data });
});

const book = asyncHandler(async (req, res) => {
  const data = await poojaService.bookPooja(req.user._id, req.body);
  return created(res, { message: 'Pooja booked successfully', data });
});

const myBookings = asyncHandler(async (req, res) => {
  const data = await poojaService.listMyBookings(req.user._id, {
    filter: req.query.filter || 'all',
  });
  return success(res, { data });
});

const myBooking = asyncHandler(async (req, res) => {
  const data = await poojaService.getMyBooking(req.user._id, req.params.id);
  return success(res, { data });
});

const cancel = asyncHandler(async (req, res) => {
  const data = await poojaService.cancelBooking(req.user._id, req.params.id, req.body?.reason);
  return success(res, { message: 'Booking cancelled', data });
});

module.exports = { list, getBySlug, book, myBookings, myBooking, cancel };
