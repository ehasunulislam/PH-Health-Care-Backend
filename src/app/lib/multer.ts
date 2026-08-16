import multer from "multer";

// set up multer the uploading files
const storage = multer.memoryStorage();
export const upload = multer({storage: storage})