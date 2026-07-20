export interface ProfileUpdatePostWriter {
  createProfilePhotoUpdatePost(
    authorId: string,
    mediaAssetId: string,
  ): Promise<void>;

  createCoverPhotoUpdatePost(
    authorId: string,
    mediaAssetId: string,
  ): Promise<void>;
}
