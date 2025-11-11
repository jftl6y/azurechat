import {
  AzureKeyCredential,
  SearchClient,
  SearchIndexClient,
  SearchIndexerClient,
} from "@azure/search-documents";
import { DefaultAzureCredential } from "@azure/identity";

const USE_MANAGED_IDENTITIES = process.env.USE_MANAGED_IDENTITIES === "true";
const AZURE_AUTHORITY_HOST = process.env.AZURE_AUTHORITY_HOST || "https://login.microsoftonline.com";
const endpointSuffix = process.env.AZURE_SEARCH_ENDPOINT_SUFFIX || "search.windows.net";
const apiKey = process.env.AZURE_SEARCH_API_KEY;
const searchName = process.env.AZURE_SEARCH_NAME;
const indexName = process.env.AZURE_SEARCH_INDEX_NAME;
const endpoint = `https://${searchName}.${endpointSuffix}`;
const debug = process.env.DEBUG === "true";

console.log("Configuration parameters:", {
  USE_MANAGED_IDENTITIES,
  AZURE_AUTHORITY_HOST,
  endpointSuffix,
  searchName,
  indexName,
  endpoint,
});

// Direct REST API search to work around Azure Government SDK bug
export const DirectSearchAPI = async <T>(
  searchText: string,
  options: {
    top?: number;
    filter?: string;
    vectorSearchOptions?: {
      queries: Array<{
        vector: number[];
        fields: string[];
        kind: string;
        kNearestNeighborsCount: number;
      }>;
    };
  }
): Promise<{ results: Array<{ score: number; document: T }> }> => {
  const apiVersion = "2023-11-01";
  const url = `https://${searchName}.${endpointSuffix}/indexes/${indexName}/docs/search?api-version=${apiVersion}`;
  
  const body: any = {
    search: searchText,
    top: options.top,
    filter: options.filter,
  };

  if (options.vectorSearchOptions) {
    body.vectorQueries = options.vectorSearchOptions.queries.map(q => ({
      vector: q.vector,
      fields: q.fields.join(","),
      kind: q.kind,
      k: q.kNearestNeighborsCount,
    }));
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "api-key": apiKey || "",
  };

  if (debug) {
    console.log("Direct REST API call to:", url);
    console.log("Request body:", JSON.stringify(body, null, 2));
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("DirectSearchAPI Error Details:", {
      status: response.status,
      statusText: response.statusText,
      url: url,
      errorBody: errorText,
      headers: Object.fromEntries(response.headers.entries()),
    });
    throw new Error(`Search API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  
  return {
    results: (data.value || []).map((item: any) => ({
      score: item["@search.score"],
      document: item as T,
    })),
  };
};

export const GetCredential = () => {
  console.log("Getting credential using", USE_MANAGED_IDENTITIES ? "Managed Identities" : "API Key");
  const credential = USE_MANAGED_IDENTITIES
    ? new DefaultAzureCredential({
        authorityHost: AZURE_AUTHORITY_HOST
      })
    : new AzureKeyCredential(apiKey);
  
  if (debug) console.log("Credential obtained:", credential);
  return credential;
}

export const AzureAISearchInstance = <T extends object>() => {
  console.log("Creating Azure AI Search Client Instance");
  const credential = GetCredential();

  const searchClient = new SearchClient<T>(
    endpoint,
    indexName,
    credential
  );

  console.log("Search Client created:", searchClient);
  return searchClient;
};

export const AzureAISearchIndexClientInstance = () => {
  console.log("Creating Azure AI Search Index Client Instance");
  const credential = GetCredential();

  const searchClient = new SearchIndexClient(
    endpoint,
    credential
  );

  console.log("Search Index Client created:", searchClient);
  return searchClient;
};

export const AzureAISearchIndexerClientInstance = () => {
  console.log("Creating Azure AI Search Indexer Client Instance");
  const credential = GetCredential();

  const client = new SearchIndexerClient(
    endpoint,
    credential
  );

  console.log("Search Indexer Client created:", client);
  return client;
};
