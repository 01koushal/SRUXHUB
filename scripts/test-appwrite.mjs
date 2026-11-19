
const endpoint = process.env.APPWRITE_ENDPOINT;
const projectId = process.env.APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const bucketId = process.env.APPWRITE_BUCKET_ID;

if (!endpoint || !projectId || !apiKey || !bucketId) {
  throw new Error("Missing Appwrite environment variables in .env");
}

const headers = {
  "X-Appwrite-Project": projectId,
  "X-Appwrite-Key": apiKey,
};

let uploadedFileId;

try {
  const form = new FormData();
  form.append("fileId", "unique()");
  form.append(
    "file",
    new Blob(["SRUXHUB Appwrite upload test!"], {
      type: "text/plain",
    }),
    "sruxhub-test.txt"
  );

  console.log("Uploading test file...");

  const uploadResponse = await fetch(
    `${endpoint}/storage/buckets/${bucketId}/files`,
    { method: "POST", headers, body: form }
  );

  const uploadResult = await uploadResponse.json();

  if (!uploadResponse.ok) {
    throw new Error(JSON.stringify(uploadResult));
  }

  uploadedFileId = uploadResult.$id;
  console.log("UPLOAD SUCCESS:", uploadedFileId);

  console.log("Deleting test file...");

  const deleteResponse = await fetch(
    `${endpoint}/storage/buckets/${bucketId}/files/${uploadedFileId}`,
    { method: "DELETE", headers }
  );

  if (!deleteResponse.ok) {
    throw new Error(await deleteResponse.text());
  }

  console.log("DELETE SUCCESS");
  console.log("APPWRITE TEST PASSED!");
} catch (error) {
  console.error("TEST FAILED:", error.message);
}
