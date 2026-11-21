
import os
import uuid
import hashlib
import requests
from dotenv import load_dotenv

# Load Appwrite credentials from .env
load_dotenv()

ENDPOINT = os.getenv("APPWRITE_ENDPOINT", "").rstrip("/")
PROJECT_ID = os.getenv("APPWRITE_PROJECT_ID")
API_KEY = os.getenv("APPWRITE_API_KEY")
BUCKET_ID = os.getenv("APPWRITE_BUCKET_ID")

# Validate configuration
if not all([ENDPOINT, PROJECT_ID, API_KEY, BUCKET_ID]):
    raise RuntimeError(
        "Missing Appwrite configuration. Check your .env file."
    )

HEADERS = {
    "X-Appwrite-Project": PROJECT_ID,
    "X-Appwrite-Key": API_KEY,
}

BASE_URL = (
    f"{ENDPOINT}/storage/buckets/"
    f"{BUCKET_ID}/files"
)

# Unique test file
file_id = str(uuid.uuid4())
filename = "srux_appwrite_test.txt"
content = b"SRUXHUB Appwrite upload and delete test."

original_hash = hashlib.sha256(content).hexdigest()


def print_response_error(response):
    print("HTTP Status:", response.status_code)
    try:
        print("Response:", response.json())
    except ValueError:
        print("Response:", response.text)


try:
    # 1. UPLOAD
    print("\n1. Testing Appwrite upload...")

    response = requests.post(
        BASE_URL,
        headers=HEADERS,
        data={
            "fileId": file_id,
        },
        files={
            "file": (
                filename,
                content,
                "text/plain",
            )
        },
        timeout=120,
    )

    if not response.ok:
        print("UPLOAD FAILED")
        print_response_error(response)
        raise RuntimeError("Appwrite upload failed.")

    uploaded = response.json()

    print("UPLOAD SUCCESS")
    print("File ID:", uploaded.get("$id"))
    print("Bucket ID:", uploaded.get("bucketId"))
    print("Name:", uploaded.get("name"))
    print("Size:", uploaded.get("sizeOriginal"))

    if uploaded.get("$id") != file_id:
        raise RuntimeError("Appwrite returned an unexpected file ID.")

    # 2. RETRIEVE METADATA
    print("\n2. Testing file metadata retrieval...")

    response = requests.get(
        f"{BASE_URL}/{file_id}",
        headers=HEADERS,
        timeout=60,
    )

    if not response.ok:
        print("METADATA RETRIEVAL FAILED")
        print_response_error(response)
        raise RuntimeError("Could not retrieve uploaded file metadata.")

    stored = response.json()

    print("METADATA RETRIEVAL SUCCESS")
    print("Stored file ID:", stored.get("$id"))
    print("Stored bucket:", stored.get("bucketId"))
    print("Stored filename:", stored.get("name"))
    print("Stored size:", stored.get("sizeOriginal"))
    print("Stored MIME:", stored.get("mimeType"))

    if stored.get("$id") != file_id:
        raise RuntimeError("Retrieved file ID does not match.")

    if int(stored.get("sizeOriginal", -1)) != len(content):
        raise RuntimeError("Stored file size does not match.")

    # 3. DOWNLOAD AND VERIFY CONTENT
    print("\n3. Testing file download and SHA-256...")

    response = requests.get(
        f"{BASE_URL}/{file_id}/download",
        headers=HEADERS,
        timeout=120,
    )

    if not response.ok:
        print("DOWNLOAD FAILED")
        print_response_error(response)
        raise RuntimeError("Could not download uploaded file.")

    downloaded_hash = hashlib.sha256(response.content).hexdigest()

    print("Original SHA-256:", original_hash)
    print("Downloaded SHA-256:", downloaded_hash)

    if downloaded_hash != original_hash:
        raise RuntimeError("SHA-256 verification failed.")

    print("DOWNLOAD AND HASH VERIFICATION SUCCESS")

    # 4. DELETE
    print("\n4. Testing file deletion...")

    response = requests.delete(
        f"{BASE_URL}/{file_id}",
        headers=HEADERS,
        timeout=60,
    )

    if not response.ok:
        print("DELETE FAILED")
        print_response_error(response)
        raise RuntimeError("Could not delete test file.")

    print("DELETE SUCCESS")

    # 5. VERIFY DELETION
    print("\n5. Verifying deletion...")

    response = requests.get(
        f"{BASE_URL}/{file_id}",
        headers=HEADERS,
        timeout=60,
    )

    if response.status_code == 404:
        print("CONFIRMED: Test file no longer exists.")
    else:
        print_response_error(response)
        raise RuntimeError("File still exists or deletion could not be verified.")

    print("\n================================")
    print("       APPWRITE TEST PASSED")
    print("================================")

except Exception as error:
    print("\n================================")
    print("       APPWRITE TEST FAILED")
    print("================================")
    print("Error:", error)

    print("Test file ID:", file_id)
    print("If upload succeeded but deletion failed,")
    print("check the Appwrite Console before retrying.")
