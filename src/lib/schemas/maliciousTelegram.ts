import mongoose from 'mongoose';

export interface MaliciousTelegramSchema {
  id: string;
  date: string;
}

const schema = new mongoose.Schema<MaliciousTelegramSchema>({
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

export const model = mongoose.model<MaliciousTelegramSchema>('maliciousTelegramData', schema);
