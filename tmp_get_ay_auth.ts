import crypto from "node:crypto";

const password = "1234567"; // mets ici le mot de passe que tu veux tester
const salt = "bf65331dfeb04ff16c0a59f774ec18d2";

const hash = crypto
  .pbkdf2Sync(password, salt, 310000, 64, "sha512")
  .toString("hex");

console.log(hash);