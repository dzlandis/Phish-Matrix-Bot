import mongoose from 'mongoose';

export interface SafeTelegram {
  id: string;
  date: string;
}

const schema = new mongoose.Schema<SafeTelegram>({
  id: {
    type: String,
    required: true,
    unique: true
  },
  date: {
    type: String,
    required: true
  }
});

export const model = mongoose.model<SafeTelegram>('safeTelegramData', schema);
