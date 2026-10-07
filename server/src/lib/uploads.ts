import multer from 'multer';
import { badRequest } from './http';

const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/** Receipt upload, held in memory and then stored in the database (see PaymentProof). */
export const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(badRequest('Receipt must be a JPG, PNG, WEBP image or a PDF'));
  },
});
