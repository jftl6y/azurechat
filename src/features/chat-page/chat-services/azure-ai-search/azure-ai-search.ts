"use server";
import "server-only";

import { userHashedId } from "@/features/auth-page/helpers";
import { ServerActionResponse } from "@/features/common/server-action-response";
import {
  AzureAISearchIndexClientInstance,
  AzureAISearchInstance,
  DirectSearchAPI,
} from "@/features/common/services/ai-search";
import { OpenAIEmbeddingInstance } from "@/features/common/services/openai";
import { uniqueId } from "@/features/common/util";
import {
  AzureKeyCredential,
  SearchClient,
  SearchIndex,
} from "@azure/search-documents";

const debug = process.env.DEBUG === "true";

export interface AzureSearchDocumentIndex {
  id: string;
  // AAR-TDR Index primary content fields
  combined_tdr_summary_text?: string;  // Primary content field for TDR summaries
  combined_aar_document_subject_intro_conclusion_aisummary_text?: string;  // Primary content for AAR documents
  combined_event_text?: string;  // Event-related content
  combined_topicarea_ddtmlpf_warfightingarea_tags_text?: string;  // Tags and categories
  
  // Vector fields (3072 dimensions)
  combined_tdr_summary_text_vector?: number[];
  combined_aar_document_subject_intro_conclusion_aisummary_text_vector?: number[];
  combined_event_text_vector?: number[];
  combined_topicarea_ddtmlpf_warfightingarea_tags_text_vector?: number[];
  
  // Metadata and extracted fields
  raw_document_url?: string;
  event_id?: string;
  extracted_subject?: string;
  extracted_topicTitleText?: string;
  extracted_topicDiscussionText?: string;
  extracted_topicRecommendationText?: string;
  extracted_fromByline?: string;
  extracted_toRecipient?: string;
  extracted_pointOfContact?: string;
  
  // AI-derived fields
  ai_derived_improveSustainRecommendation?: string;
  ai_derived_missionImpactMeasure?: string;
  ai_derived_missionImpactSummary?: string;
  
  // Tag and classification fields
  topic_keywords?: string;
  all_topic_areas?: string;
  all_warfighting_functions?: string;
  all_ddtmlpf_areas?: string;
  all_document_references?: string;
  all_document_enclosures?: string;
  
  // Legacy fields for backward compatibility with uploaded documents
  pageContent?: string;
  embedding?: number[];  // Legacy vector field
  user?: string;
  chatThreadId?: string;
  metadata?: string;
}

export type DocumentSearchResponse = {
  score: number;
  document: AzureSearchDocumentIndex;
};

export const SimpleSearch = async (
  searchText?: string,
  filter?: string
): Promise<ServerActionResponse<Array<DocumentSearchResponse>>> => {
  try {
    if (debug) console.log("Executing SimpleSearch with searchText:", searchText, "filter:", filter);
    const instance = AzureAISearchInstance<AzureSearchDocumentIndex>();
    const searchResults = await instance.search(searchText, { filter: filter });

    const results: Array<DocumentSearchResponse> = [];
    for await (const result of searchResults.results) {
      results.push({
        score: result.score,
        document: result.document,
      });
    }

    if (debug) console.log("SimpleSearch results:", results);
    return {
      status: "OK",
      response: results,
    };
  } catch (e) {
    console.error("SimpleSearch error:", e);
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const SimilaritySearch = async (
  searchText: string,
  k: number,
  filter?: string
): Promise<ServerActionResponse<Array<DocumentSearchResponse>>> => {
  try {
    if (debug) console.log("Executing SimilaritySearch with searchText:", searchText, "k:", k, "filter:", filter);
    const openai = OpenAIEmbeddingInstance();
    const embeddings = await openai.embeddings.create({
      input: searchText,
      model: process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME || "",
      dimensions: 3072,  // AAR-TDR index uses 3072-dimension vectors
    });

    if (debug) console.log("Embeddings obtained:", embeddings);

    // Use direct REST API to work around Azure Government SDK bug
    const searchResults = await DirectSearchAPI<AzureSearchDocumentIndex>(searchText, {
      top: k,
      filter: filter,
      vectorSearchOptions: {
        queries: [
          {
            vector: embeddings.data[0].embedding,
            fields: ["combined_tdr_summary_text_vector"],  // Primary vector field for TDR content
            kind: "vector",
            kNearestNeighborsCount: 10,
          },
        ],
      },
    });

    const results: Array<DocumentSearchResponse> = searchResults.results.map(result => ({
      score: result.score,
      document: result.document,
    }));

    if (debug) console.log("SimilaritySearch results:", results);
    return {
      status: "OK",
      response: results,
    };
  } catch (e) {
    console.error("SimilaritySearch error:", e);
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const ExtensionSimilaritySearch = async (props: {
  searchText: string;
  vectors: string[];
  apiKey: string;
  searchName: string;
  indexName: string;
}): Promise<ServerActionResponse<Array<DocumentSearchResponse>>> => {
  try {
    if (debug) console.log("Executing ExtensionSimilaritySearch with props:", props);
    const openai = OpenAIEmbeddingInstance();
    const { searchText, vectors, apiKey, searchName, indexName } = props;

    const embeddings = await openai.embeddings.create({
      input: searchText,
      model: process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME || "",
      dimensions: 3072,  // AAR-TDR index uses 3072-dimension vectors
    });

    if (debug) console.log("Embeddings obtained:", embeddings);

    // Use direct REST API to work around Azure Government SDK bug
    const endpointSuffix = process.env.AZURE_SEARCH_ENDPOINT_SUFFIX || "search.windows.net";
    const apiVersion = "2023-11-01";
    const url = `https://${searchName}.${endpointSuffix}/indexes/${indexName}/docs/search?api-version=${apiVersion}`;
    
    const body = {
      search: searchText,
      top: 3,
      vectorQueries: [
        {
          vector: embeddings.data[0].embedding,
          fields: vectors.join(","),
          kind: "vector",
          k: 10,
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Search API Error Details:", {
        status: response.status,
        statusText: response.statusText,
        url: url,
        errorBody: errorText,
        headers: Object.fromEntries(response.headers.entries()),
      });
      throw new Error(`Search API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    const results: Array<any> = (data.value || []).map((item: any) => {
      const document = { ...item };
      const newDocument: any = {};

      // Remove vector fields from the response
      for (const key in document) {
        const hasKey = vectors.includes(key);
        if (!hasKey && key !== "@search.score") {
          newDocument[key] = document[key];
        }
      }

      return {
        score: item["@search.score"],
        document: newDocument,
      };
    });

    if (debug) console.log("ExtensionSimilaritySearch results:", results);
    return {
      status: "OK",
      response: results,
    };
  } catch (e) {
    console.error("ExtensionSimilaritySearch error:", e);
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const IndexDocuments = async (
  fileName: string,
  docs: string[],
  chatThreadId: string
): Promise<Array<ServerActionResponse<boolean>>> => {
  try {
    if (debug) console.log("Indexing documents with fileName:", fileName, "chatThreadId:", chatThreadId);
    const documentsToIndex: AzureSearchDocumentIndex[] = [];

    for (const doc of docs) {
      const docToAdd: AzureSearchDocumentIndex = {
        id: uniqueId(),
        chatThreadId,
        user: await userHashedId(),
        pageContent: doc,  // Legacy field for backward compatibility
        combined_tdr_summary_text: doc,  // New field matching AAR-TDR index schema
        metadata: fileName,
        combined_tdr_summary_text_vector: [],  // Vector field for AAR-TDR index (3072 dimensions)
      };

      documentsToIndex.push(docToAdd);
    }

    if (debug) console.log("Documents to index:", documentsToIndex);

    const instance = AzureAISearchInstance();
    const embeddingsResponse = await EmbedDocuments(documentsToIndex);

    if (embeddingsResponse.status === "OK") {
      const uploadResponse = await instance.uploadDocuments(
        embeddingsResponse.response
      );

      const response: Array<ServerActionResponse<boolean>> = [];
      uploadResponse.results.forEach((r) => {
        if (r.succeeded) {
          response.push({
            status: "OK",
            response: r.succeeded,
          });
        } else {
          response.push({
            status: "ERROR",
            errors: [
              {
                message: `${r.errorMessage}`,
              },
            ],
          });
        }
      });

      if (debug) console.log("IndexDocuments response:", response);
      return response;
    }

    return [embeddingsResponse];
  } catch (e) {
    console.error("IndexDocuments error:", e);
    return [
      {
        status: "ERROR",
        errors: [
          {
            message: `${e}`,
          },
        ],
      },
    ];
  }
};

export const DeleteDocuments = async (
  chatThreadId: string
): Promise<Array<ServerActionResponse<boolean>>> => {
  try {
    if (debug) console.log("Deleting documents for chatThreadId:", chatThreadId);
    const documentsInChatResponse = await SimpleSearch(
      undefined,
      `chatThreadId eq '${chatThreadId}'`
    );

    if (documentsInChatResponse.status === "OK") {
      const instance = AzureAISearchInstance();
      const deletedResponse = await instance.deleteDocuments(
        documentsInChatResponse.response.map((r) => r.document)
      );

      const response: Array<ServerActionResponse<boolean>> = [];
      deletedResponse.results.forEach((r) => {
        if (r.succeeded) {
          response.push({
            status: "OK",
            response: r.succeeded,
          });
        } else {
          response.push({
            status: "ERROR",
            errors: [
              {
                message: `${r.errorMessage}`,
              },
            ],
          });
        }
      });

      if (debug) console.log("DeleteDocuments response:", response);
      return response;
    }

    return [documentsInChatResponse];
  } catch (e) {
    console.error("DeleteDocuments error:", e);
    return [
      {
        status: "ERROR",
        errors: [
          {
            message: `${e}`,
          },
        ],
      },
    ];
  }
};

export const EmbedDocuments = async (
  documents: Array<AzureSearchDocumentIndex>
): Promise<ServerActionResponse<Array<AzureSearchDocumentIndex>>> => {
  try {
    if (debug) console.log("Embedding documents:", documents.map((d) => d.id));
    const openai = OpenAIEmbeddingInstance();
    const contentsToEmbed = documents.map((d) => d.pageContent || d.combined_tdr_summary_text || d.combined_aar_document_subject_intro_conclusion_aisummary_text || "");

    const embeddings = await openai.embeddings.create({
      input: contentsToEmbed,
      model: process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME,
      dimensions: 3072,  // AAR-TDR index uses 3072-dimension vectors
    });

    if (debug) console.log("Embeddings received:", embeddings);

    embeddings.data.forEach((embedding, index) => {
      documents[index].embedding = embedding.embedding;  // Legacy field
      documents[index].combined_tdr_summary_text_vector = embedding.embedding;  // AAR-TDR index vector field
    });

    if (debug) console.log("Documents after embedding:", documents);
    return {
      status: "OK",
      response: documents,
    };
  } catch (e) {
    console.error("EmbedDocuments error:", e);
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

export const EnsureIndexIsCreated = async (): Promise<
  ServerActionResponse<SearchIndex>
> => {
  try {
    console.log("Ensuring index is created: ", process.env.AZURE_SEARCH_INDEX_NAME);
    const client = AzureAISearchIndexClientInstance();
    const result = await client.getIndex(process.env.AZURE_SEARCH_INDEX_NAME);
    console.log("Index exists: ", result);
    return {
      status: "OK",
      response: result,
    };
  } catch (e) {
    console.log(`Error Creating index:${e}`);
    return await CreateSearchIndex();
  }
};

const CreateSearchIndex = async (): Promise<
  ServerActionResponse<SearchIndex>
> => {
  try {
    console.log("Creating search index");
    const client = AzureAISearchIndexClientInstance();
    const result = await client.createIndex({
      name: process.env.AZURE_SEARCH_INDEX_NAME,
      vectorSearch: {
        algorithms: [
          {
            name: "hnsw-vector",
            kind: "hnsw",
            parameters: {
              m: 4,
              efConstruction: 200,
              efSearch: 200,
              metric: "cosine",
            },
          },
        ],
        profiles: [
          {
            name: "hnsw-vector",
            algorithmConfigurationName: "hnsw-vector",
          },
        ],
      },

      fields: [
        {
          name: "id",
          type: "Edm.String",
          key: true,
          filterable: true,
        },
        {
          name: "user",
          type: "Edm.String",
          searchable: true,
          filterable: true,
        },
        {
          name: "chatThreadId",
          type: "Edm.String",
          searchable: true,
          filterable: true,
        },
        {
          name: "pageContent",
          searchable: true,
          type: "Edm.String",
        },
        {
          name: "metadata",
          type: "Edm.String",
        },
        {
          name: "embedding",
          type: "Collection(Edm.Single)",
          searchable: true,
          filterable: false,
          sortable: false,
          facetable: false,
          vectorSearchDimensions: 3072,
          vectorSearchProfileName: "hnsw-vector",
        },
      ],
    });

    console.log("Search index created:", result);
    return {
      status: "OK",
      response: result,
    };
  } catch (e) {
    console.error("CreateSearchIndex error:", e);
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};
