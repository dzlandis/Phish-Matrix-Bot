import mongoose from 'mongoose';

export interface EventWarningSchema {
  suspectMessageId: string;
  suspectId: string;
  responseMessageId?: string;
  suspectURL?: string;
  suspectMessageRemoved?: boolean;
}

const schema = new mongoose.Schema<EventWarningSchema>({
  suspectMessageId: {
    type: String,
    required: true,
    unique: true
  },
  suspectId: {
    type: String,
    required: true
  },
  responseMessageId: {
    type: String,
    unique: true
  },
  suspectURL: {
    type: String
  },
  suspectMessageRemoved: {
    type: Boolean
  }
});

export const model = mongoose.model<EventWarningSchema>('eventWarningData', schema);
