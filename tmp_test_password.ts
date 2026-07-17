import crypto from "node:crypto";

const password = "1234567";
const salt = "68c5c7f4a5b77afc1de9c2aa02eba7a0";

const hash = crypto
  .pbkdf2Sync(password, salt, 310000, 64, "sha512")
  .toString("hex");

console.log(hash);