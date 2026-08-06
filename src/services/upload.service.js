const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/AppError');
const config = require('../config');
const logger = require('../utils/logger');

const uploadBuffer = (buffer, folder = 'astroverse', options = {}) =>
  new Promise((resolve, reject) => {
    if (!config.cloudinary.cloudName) {
      // Dev fallback: return data URL placeholder path
      const stub = {
        secure_url: `https://placehold.co/600x400?text=AstroVerse`,
        public_id: `stub/${Date.now()}`,
        stub: true,
      };
      logger.warn('Cloudinary not configured – using stub upload');
      return resolve(stub);
    }

    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto', ...options },
      (err, result) => {
        if (err) return reject(new AppError(`Upload failed: ${err.message}`, 500));
        return resolve(result);
      }
    );
    stream.end(buffer);
  });

const deleteFile = async (publicId) => {
  if (!publicId || publicId.startsWith('stub/')) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    logger.warn(`Cloudinary delete failed: ${err.message}`);
  }
};

module.exports = { uploadBuffer, deleteFile };
