> Source: https://ai.google.dev/gemini-api/docs/file-input-methods (snapshot 2026-09-16)
>
> Java samples removed.

This guide explains the different ways you can include media files such as
images, audio, video, and documents when making requests to the Gemini API.
The new methods are supported in all of the Gemini API endpoints, including
Batch, Interactions and Live API.
Choosing the right method depends on the size of your file, where your data is
stored, and how frequently you plan to use the file.

The simplest way to include a file as your input is to read a local file and
include it in a prompt. The following example shows how to read a local PDF
file. PDFs are limited to 50MB for this method. See the
[Input method comparison table](https://ai.google.dev/gemini-api/docs/file-input-methods#method-comparison) for a complete list of file
input types and limits.

### Python

    from google import genai
    import pathlib
    import base64

    client = genai.Client()

    filepath = pathlib.Path('my_local_file.pdf')

    prompt = "Summarize this document"
    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {"type": "text", "text": prompt},
            {"type": "document", "data": base64.b64encode(filepath.read_bytes()).decode('utf-8'), "mime_type": "application/pdf"}
        ]
    )
    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from "@google/genai";
    import * as fs from 'node:fs';

    const client = new GoogleGenAI({});
    const prompt = "Summarize this document";

    async function main() {
        const filePath = 'my_local_file.pdf';

        const interaction = await client.interactions.create({
            model: "gemini-3.8-flash",
            input: [
                { type: "text", text: prompt },
                {
                    type: "document",
                    data: fs.readFileSync(filePath).toString("base64"),
                    mime_type: "application/pdf"
                }
            ]
        });
        console.log(interaction.output_text);
    }

    main();

### REST

    # Encode the local file to base64
    B64_CONTENT=$(base64 -w 0 my_local_file.pdf)

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": [
          {"type": "text", "text": "Summarize this document"},
          {
            "type": "document",
            "data": "'${B64_CONTENT}'",
            "mime_type": "application/pdf"
          }
        ]
      }'

## Input method comparison

The following table compares each input method with file limits and best use
cases. Note that the file size limit may vary depending on the file type and
model or tokenizer used to process the file.

| Method | Best for | Max file size | Persistence |
|---|---|---|---|
| **Inline data** | Quick testing, small files, real-time applications. | 100 MB per request or payload (**50 MB for PDFs**) | None (sent with every request) |
| **File API upload** | Large files, files used multiple times. | 2 GB per file, up to 20GB per project | 48 Hours |
| **File API GCS URI registration** | Large files already in Google Cloud Storage, files used multiple times. | 2 GB per file, no overall storage limits | None (fetched per request). One time registration can give access for up to 30 days. |
| **External URLs** | Public data or data in cloud buckets (AWS, Azure, GCS) without re-uploading. | 100 MB per request/payload | None (fetched per request) |

## Inline data

For smaller files (under 100MB, or 50MB for PDFs), you can pass the data
directly in the request payload. This is the simplest method for quick tests or
applications handling real-time, transient data. You can provide data as
base64 encoded strings or by reading local files directly.

For an example of reading from a local file, see the example at the beginning of
this page.

### Fetch from a URL

You can also fetch a file from a URL, convert it to bytes, and include it in the
input.

### Python

    from google import genai
    import httpx

    client = genai.Client()

    doc_url = "https://discovery.ucl.ac.uk/id/eprint/10089234/1/343019_3_art_0_py4t4l_convrt.pdf"
    doc_data = httpx.get(doc_url).content

    prompt = "Summarize this document"

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {"type": "document", "data": base64.b64encode(doc_data).decode('utf-8'), "mime_type": "application/pdf"},
            {"type": "text", "text": prompt}
        ]
    )
    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const client = new GoogleGenAI({});
    const docUrl = 'https://discovery.ucl.ac.uk/id/eprint/10089234/1/343019_3_art_0_py4t4l_convrt.pdf';
    const prompt = "Summarize this document";

    async function main() {
        const pdfResp = await fetch(docUrl)
          .then((response) => response.arrayBuffer());

        const interaction = await client.interactions.create({
            model: "gemini-3.8-flash",
            input: [
                { type: "text", text: prompt },
                {
                    type: "document",
                    data: Buffer.from(pdfResp).toString("base64"),
                    mime_type: "application/pdf"
                }
            ]
        });
        console.log(interaction.output_text);
    }

    main();

### REST

    DOC_URL="https://discovery.ucl.ac.uk/id/eprint/10089234/1/343019_3_art_0_py4t4l_convrt.pdf"
    PROMPT="Summarize this document"
    DISPLAY_NAME="base64_pdf"

    # Download the PDF
    wget -O "${DISPLAY_NAME}.pdf" "${DOC_URL}"

    # Check for FreeBSD base64 and set flags accordingly
    if [[ "$(base64 --version 2>&1)" = *"FreeBSD"* ]]; then
      B64FLAGS="--input"
    else
      B64FLAGS="-w0"
    fi

    # Base64 encode the PDF
    ENCODED_PDF=$(base64 $B64FLAGS "${DISPLAY_NAME}.pdf")

    # Create JSON payload file
    cat <<EOF > payload.json
    {
    "model": "gemini-3.8-flash",
    "input": [
    {"type": "document", "data": "${ENCODED_PDF}", "mime_type": "application/pdf"},
    {"type": "text", "text": "${PROMPT}"}
    ]
    }
    EOF

    # Generate content using interactions
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
        -H "x-goog-api-key: $GEMINI_API_KEY" \
        -H 'Content-Type: application/json' \
        -d @payload.json 2> /dev/null > response.json

    cat response.json
    echo

    jq ".outputs[] | select(.type == \"text\") | .text" response.json

## Gemini File API

The File API is designed for larger files (up to 2GB) or files you intend to
use in multiple requests.

### Standard file upload

Upload a local file to the Gemini API. Files uploaded this way are stored
temporarily (48 hours) and processed for efficient retrieval by the model.

### Python

    from google import genai

    client = genai.Client()

    doc_file = client.files.upload(file="path/to/your/sample.pdf")
    prompt = "Summarize this document"

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {"type": "text", "text": prompt},
            {"type": "document", "uri": doc_file.uri, "mime_type": doc_file.mime_type}
        ]
    )
    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const client = new GoogleGenAI({});
    const prompt = "Summarize this document";

    async function main() {
      const filePath = "path/to/your/sample.pdf";

      const myfile = await client.files.upload({
        file: filePath,
        config: { mime_type: "application/pdf" },
      });

      const interaction = await client.interactions.create({
        model: "gemini-3.8-flash",
        input: [
            { type: "text", text: prompt },
            { type: "document", uri: myfile.uri, mime_type: myfile.mimeType }
        ]
      });
      console.log(interaction.output_text);
    }

    await main();

### REST

    FILE_PATH="path/to/sample.pdf"
    MIME_TYPE=$(file -b --mime-type "${FILE_PATH}")
    NUM_BYTES=$(wc -c < "${FILE_PATH}")
    DISPLAY_NAME=DOCUMENT

    tmp_header_file=upload-header.tmp

    # Initial resumable request defining metadata.
    curl "https://generativelanguage.googleapis.com/upload/v1beta/files" \
      -D "${tmp_header_file}" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H "X-Goog-Upload-Protocol: resumable" \
      -H "X-Goog-Upload-Command: start" \
      -H "X-Goog-Upload-Header-Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Header-Content-Type: ${MIME_TYPE}" \
      -H "Content-Type: application/json" \
      -d "{'file': {'display_name': '${DISPLAY_NAME}'}}" 2> /dev/null

    upload_url=$(grep -i "x-goog-upload-url: " "${tmp_header_file}" | cut -d" " -f2 | tr -d "\r")
    rm "${tmp_header_file}"

    # Upload the actual bytes.
    curl "${upload_url}" \
      -H "Content-Length: ${NUM_BYTES}" \
      -H "X-Goog-Upload-Offset: 0" \
      -H "X-Goog-Upload-Command: upload, finalize" \
      --data-binary "@${FILE_PATH}" 2> /dev/null > file_info.json

    file_uri=$(jq ".file.uri" file_info.json)

    # Now use in an interaction
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
        -H "x-goog-api-key: $GEMINI_API_KEY" \
        -H 'Content-Type: application/json' \
        -d '{
          "model": "gemini-3.8-flash",
          "input": [
            {"type": "text", "text": "Summarize this document"},
            {"type": "document", "uri": '$file_uri', "mime_type": "'${MIME_TYPE}'"}
          ]
        }'

### Register Google Cloud Storage files

If your data is already in Google Cloud Storage, you don't need to
download and re-upload it. You can register it directly with the File API.

1. Grant **Service Agent** access to each bucket

   1. Enable the Gemini API in your Google Cloud project.

   2. Create the Service Agent:

      `gcloud beta services identity create --service=generativelanguage.googleapis.com --project=<your_project>`
   3. **Grant the Gemini API Service Agent permissions** to read your storage
      buckets.

      The user needs to assign the `Storage Object Viewer`
      [IAM role](https://docs.cloud.google.com/storage/docs/access-control/iam-roles#storage.objectViewer)
      to this service agent on the specific storage buckets they intend to use.

   This access doesn't expire by default, but can be changed at any time. You can
   also use the
   [Google Cloud Storage IAM SDK](https://cloud.google.com/iam/docs/write-policy-client-libraries)
   commands to grant permissions.
2. Authenticate your service

   **Prerequisites**
   - Enable API
   - Create a service account or agent with appropriate permissions.

   You first need to authenticate as the service that has storage object viewer
   permissions. How this happens depends on the environment in which your file
   management code will be running.

   **Outside of Google Cloud**

   If your code is running from outside of Google Cloud, such as your desktop,
   download the account credentials from the Google Cloud Console with the
   following steps:
   1. Browse to the [Service Account console](https://console.cloud.google.com/iam-admin/serviceaccounts)
   2. Select the relevant service account
   3. Select the **Keys** tab and choose **Add key, Create new key**
   4. Choose the **JSON** key type, and note where the file was downloaded to on your machine.

   For more details, see the official Google Cloud documentation on
   [service account key management](https://docs.cloud.google.com/iam/docs/keys-create-delete).

   Then use the following commands to authenticate. These commands assume your
   service account file is in the current directory, named
   `service-account.json`.

   ### Python

       from google.oauth2.service_account import Credentials

       GCS_READ_SCOPES = [
         'https://www.googleapis.com/auth/devstorage.read_only',
         'https://www.googleapis.com/auth/cloud-platform'
       ]

       SERVICE_ACCOUNT_FILE = 'service-account.json'

       credentials = Credentials.from_service_account_file(
           SERVICE_ACCOUNT_FILE,
           scopes=GCS_READ_SCOPES
       )

   ### Javascript

       const { GoogleAuth } = require('google-auth-library');

       const GCS_READ_SCOPES = [
         'https://www.googleapis.com/auth/devstorage.read_only',
         'https://www.googleapis.com/auth/cloud-platform'
       ];

       const SERVICE_ACCOUNT_FILE = 'service-account.json';

       const auth = new GoogleAuth({
         keyFile: SERVICE_ACCOUNT_FILE,
         scopes: GCS_READ_SCOPES
       });

   ### CLI

       gcloud auth application-default login \
         --client-id-file=service-account.json \
         --scopes='https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/devstorage.read_only'

   **On Google Cloud**

   If you are running directly in Google Cloud, for example by using [Cloud
   Run functions](https://cloud.google.com/functions) or a
   [Compute Engine instance](https://cloud.google.com/products/compute), you will
   have implicit credentials but will need to re-authenticate to grant the
   appropriate scopes.

   ### Python

   This code expects that the service is running in an environment where
   [Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)
   can be obtained automatically, such as Cloud Run or Compute Engine.

       import google.auth

       GCS_READ_SCOPES = [
         'https://www.googleapis.com/auth/devstorage.read_only',
         'https://www.googleapis.com/auth/cloud-platform'
       ]

       credentials, project = google.auth.default(scopes=GCS_READ_SCOPES)

   ### JavaScript

   This code expects that the service is running in an environment where
   [Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)
   can be obtained automatically, such as Cloud Run or Compute Engine.

       const { GoogleAuth } = require('google-auth-library');

       const auth = new GoogleAuth({
         scopes: [
           'https://www.googleapis.com/auth/devstorage.read_only',
           'https://www.googleapis.com/auth/cloud-platform'
         ]
       });

### CLI

This is an interactive command. For services like Compute Engine you can attach scopes to
the running service at the config level. See the [user-managed service
docs](https://docs.cloud.google.com/compute/docs/access/create-enable-service-accounts-for-instances#using)
for an example.

    gcloud auth application-default login \
    --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/devstorage.read_only"

1. File registration (Files API) Use the Files API to register files and produce a Files API path that can directly be used in the Gemini API.

   ### Python

       from google import genai

       client = genai.Client(credentials=credentials)

       registered_gcs_files = client.files.register_files(
           uris=["gs://my_bucket/some_object.pdf", "gs://bucket2/object2.txt"]
       )
       prompt = "Summarize this file."

       for f in registered_gcs_files.files:
         print(f.name)
         interaction = client.interactions.create(
           model="gemini-3.8-flash",
           input=[
             {"type": "text", "text": prompt},
             {"type": "document", "uri": f.uri, "mime_type": f.mime_type}
           ],
         )
         print(interaction.output_text)

   ### JavaScript

       import { GoogleGenAI } from "@google/genai";

       const ai = new GoogleGenAI({ auth: auth });

       async function main() {
           const registeredGcsFiles = await ai.files.registerFiles({
               uris: ["gs://my_bucket/some_object.pdf", "gs://bucket2/object2.txt"]
           });

           const prompt = "Summarize this file.";

           for (const file of registeredGcsFiles.files) {
               console.log(file.name);
               const interaction = await ai.interactions.create({
                   model: "gemini-3.8-flash",
                   input: [
                       { type: "text", text: prompt },
                       { type: "document", uri: file.uri, mime_type: file.mimeType }
                   ]
               });

               console.log(interaction.output_text);
           }
       }

       main();

### CLI

    access_token=$(gcloud auth application-default print-access-token)
    project_id=$(gcloud config get-value project)
    curl -X POST https://generativelanguage.googleapis.com/v1beta/files:register \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer ${access_token}" \
        -H "x-goog-user-project: ${project_id}" \
        -d '{"uris": ["gs://bucket/object1", "gs://bucket/object2"]}'

## External HTTP / Signed URLs

You can pass publicly accessible HTTPS URLs or pre-signed URLs directly in your
request. The Gemini API will fetch the content securely during processing.
This is ideal for files up to 100MB that you don't want to re-upload.

> [!NOTE]
> **Note:** Gemini 2.0 family of models are not supported

### Python

    from google import genai

    uri = "https://ontheline.trincoll.edu/images/bookdown/sample-local-pdf.pdf"
    prompt = "Summarize this file"

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {"type": "document", "uri": uri, "mime_type": "application/pdf"},
            {"type": "text", "text": prompt}
        ]
    )
    print(interaction.output_text)

### Javascript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const uri = "https://ontheline.trincoll.edu/images/bookdown/sample-local-pdf.pdf";

    async function main() {
      const interaction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: [
          { type: "document", uri: uri, mime_type: "application/pdf" },
          { type: "text", text: "summarize this file" }
        ]
      });

      console.log(interaction.output_text);
    }

    main();

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
          -H 'x-goog-api-key: $GEMINI_API_KEY' \
          -H 'Content-Type: application/json' \
          -d '{
              "model": "gemini-3.8-flash",
              "input": [
                {"type": "text", "text": "Summarize this pdf"},
                {
                  "type": "document",
                  "uri": "https://ontheline.trincoll.edu/images/bookdown/sample-local-pdf.pdf",
                  "mime_type": "application/pdf"
                }
              ]
            }'

### Accessibility

Verify that the URLs you provide don't lead to pages that require a login or
are behind a paywall. For private databases, ensure you create a signed URL
with the correct access permissions and expiry.

### Safety checks

The system performs a content moderation check on the URL to confirm they meet
safety and policy standards. If the URL fails this check, you will get an
`url_retrieval_status` of `URL_RETRIEVAL_STATUS_UNSAFE`.

### Supported content types

This list of supported file types and limitations is intended as initial
guidance and is not comprehensive. The effective
set of supported types is subject to change and can vary based on the specific
model and tokenizer version in use. Unsupported types will result in an error.
Additionally, content retrieval for these file types
only supports publicly accessible URLs.

#### Text file types

- `text/html`
- `text/css`
- `text/plain`
- `text/xml`
- `text/csv`
- `text/rtf`
- `text/javascript`

#### Application file types

- `application/json`
- `application/pdf`

#### Image file types

- `image/bmp`
- `image/jpeg`
- `image/png`
- `image/webp`

#### Video file types

- `video/mp4`
- `video/mpeg`
- `video/quicktime`
- `video/avi`
- `video/x-flv`
- `video/mpg`
- `video/webm`
- `video/wmv`
- `video/3gpp`

## Best practices

- **Choose the right method:** Use inline data for small, transient files. Use the File API for larger or frequently used files. Use external URLs for data already hosted online.
- **Specify MIME Types:** Always provide the correct MIME type for the file data to ensure proper processing.
- **Handle Errors:** Implement error handling in your code to manage potential issues like network failures, file access problems, or API errors.

## Limitations

- File size limits vary by method (see [comparison table](https://ai.google.dev/gemini-api/docs/file-input-methods#method-comparison)) and file type.
- Inline data increases request payload size.
- File API uploads are temporary and expire after 48 hours.
- External URL fetching is limited to 100MB per payload and supports specific content types.

## What's next

- Try writing your own multimodal prompts using [Google AI Studio](http://aistudio.google.com/).
- For information on including files in your prompts, see the [Vision](https://ai.google.dev/gemini-api/docs/vision), [Audio](https://ai.google.dev/gemini-api/docs/audio), and [Document processing](https://ai.google.dev/gemini-api/docs/document-processing) guides.
