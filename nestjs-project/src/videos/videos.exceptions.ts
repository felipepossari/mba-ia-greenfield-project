import { DomainException } from '../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class UploadAlreadyCompletedException extends DomainException {
  constructor() {
    super(
      'UPLOAD_ALREADY_COMPLETED',
      409,
      'Upload has already been completed for this video',
    );
  }
}

export class InvalidUploadPartsException extends DomainException {
  constructor() {
    super(
      'INVALID_UPLOAD_PARTS',
      400,
      "Uploaded parts do not match the storage provider's record",
    );
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready for playback');
  }
}
