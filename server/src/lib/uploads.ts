import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../env';
import { badRequest } from './http';

export const proofDir = path.resolve(env.UPLOAD_DIR, 'proofs');
fs.mkdirSync(proofDir, { recursive: true });

const allowed: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export const proofUpload = multer({
  storage: multer.diskStorage({
    destination: proofDir,
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + allowed[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (allowed[file.mimetype]) cb(null, true);
    else cb(badRequest('Receipt must be a JPG, PNG, WEBP image or a PDF'));
  },
});

/** Absolute path of a stored proof, refusing anything that would escape the proofs folder. */
export function proofFile(name: string) {
  const full = path.resolve(proofDir, path.basename(name));
  if (!full.startsWith(proofDir + path.sep)) throw badRequest('Invalid file');
  return full;
}
