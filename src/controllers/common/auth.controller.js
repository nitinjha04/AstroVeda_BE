const authService = require('../../services/auth.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../utils/apiResponse');

const register = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body);
  return created(res, { message: 'Registration successful', data });
});

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body);
  return success(res, { message: 'Login successful', data });
});

const sendOtp = asyncHandler(async (req, res) => {
  const data = await authService.sendOtp(req.body);
  return success(res, { message: data.message, data });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const data = await authService.verifyOtp(req.body);
  return success(res, { message: 'OTP verified', data });
});

const googleLogin = asyncHandler(async (req, res) => {
  const data = await authService.googleLogin(req.body.idToken);
  return success(res, { message: 'Google login successful', data });
});

const refresh = asyncHandler(async (req, res) => {
  const data = await authService.refreshTokens(req.body.refreshToken);
  return success(res, { message: 'Token refreshed', data });
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user._id, req.body.refreshToken);
  return success(res, { message: 'Logged out' });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const data = await authService.forgotPassword(req.body.email);
  return success(res, { message: data.message, data });
});

const resetPassword = asyncHandler(async (req, res) => {
  const data = await authService.resetPassword(req.body);
  return success(res, { message: data.message });
});

const me = asyncHandler(async (req, res) => {
  return success(res, { data: req.user.toSafeObject() });
});

module.exports = {
  register,
  login,
  sendOtp,
  verifyOtp,
  googleLogin,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  me,
};
