import {
  AzureKeyCredential,
  DocumentAnalysisClient,
} from "@azure/ai-form-recognizer";
import { DefaultAzureCredential } from "@azure/identity";

const USE_MANAGED_IDENTITIES = process.env.USE_MANAGED_IDENTITIES === "true";
const AZURE_AUTHORITY_HOST = process.env.AZURE_AUTHORITY_HOST || "https://login.microsoftonline.com";
console.log("Using Managed Identities:", USE_MANAGED_IDENTITIES);

const debug = process.env.DEBUG === "true";

export const DocumentIntelligenceInstance = () => {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  console.log("Document Intelligence Endpoint:", endpoint);

  if (!endpoint) {
    throw new Error(
      "Document Intelligence environment variable for the endpoint is not set"
    );
  }

  const credential = USE_MANAGED_IDENTITIES
    ? new DefaultAzureCredential({
        authorityHost: AZURE_AUTHORITY_HOST
      })
    : new AzureKeyCredential(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY);

  if (!USE_MANAGED_IDENTITIES && !process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY) {
    throw new Error(
      "Document Intelligence environment variable for the key is not set"
    );
  }

  console.log("Credential obtained using", USE_MANAGED_IDENTITIES ? "Managed Identities" : "API Key");

  const client = new DocumentAnalysisClient(endpoint, credential);
  if (debug) console.log("Document Analysis Client created:", client);

  return client;
};
