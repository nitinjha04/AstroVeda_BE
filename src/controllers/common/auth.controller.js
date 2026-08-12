const authService = require('../../services/auth.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../utils/apiResponse');
const { setAuthCookies, clearAuthCookies, extractRefreshToken } = require('../../utils/authCookies');

/** Attach tokens in JSON body AND set httpOnly cookies (dual strategy). */
function respondWithAuth(res, { statusFn, message, data }) {
  const { user, accessToken, refreshToken, ...rest } = data || {};
  if (accessToken) {
    setAuthCookies(res, { accessToken, refreshToken });
  }
  return statusFn(res, {
    message,
    data: {
      user,
      accessToken,
      refreshToken,
      ...rest,
      // nested form for clients that expect data.tokens
      tokens: accessToken
        ? { accessToken, refreshToken }
        : undefined,
    },
  });
}

const register = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body);
  return respondWithAuth(res, {
    statusFn: created,
    message: 'Registration successful',
    data,
  });
});

const sendRegisterOtp = asyncHandler(async (req, res) => {
  const data = await authService.sendRegisterOtp(req.body);
  return success(res, { message: data.message, data });
});

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body);
  return respondWithAuth(res, {
    statusFn: success,
    message: 'Login successful',
    data,
  });
});

const sendOtp = asyncHandler(async (req, res) => {
  const data = await authService.sendOtp(req.body);
  return success(res, { message: data.message, data });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const data = await authService.verifyOtp(req.body);
  return respondWithAuth(res, {
    statusFn: success,
    message: 'OTP verified',
    data,
  });
});

const googleLogin = asyncHandler(async (req, res) => {
  const data = await authService.googleLogin(req.body.idToken);
  return respondWithAuth(res, {
    statusFn: success,
    message: 'Google login successful',
    data,
  });
});

const refresh = asyncHandler(async (req, res) => {
  const refreshToken = extractRefreshToken(req);
  const data = await authService.refreshTokens(refreshToken);
  return respondWithAuth(res, {
    statusFn: success,
    message: 'Token refreshed',
    data,
  });
});

const logout = asyncHandler(async (req, res) => {
  const refreshToken = extractRefreshToken(req);
  if (req.user?._id) {
    await authService.logout(req.user._id, refreshToken);
  }
  clearAuthCookies(res);
  return success(res, { message: 'Logged out' });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const data = await authService.forgotPassword(req.body.email);
  return success(res, { message: data.message, data });
});

const resetPassword = asyncHandler(async (req, res) => {
  const data = await authService.resetPassword(req.body);
  clearAuthCookies(res);
  return success(res, { message: data.message });
});

const me = asyncHandler(async (req, res) => {
  return success(res, { data: req.user.toSafeObject() });
});

module.exports = {
  register,
  sendRegisterOtp,
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
