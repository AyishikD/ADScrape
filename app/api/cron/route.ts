import { NextResponse } from "next/server";
import { getLowestPrice, getHighestPrice, getAveragePrice, getEmailNotifType } from "@/lib/utils";
import { connectToDB } from "@/lib/mongoose";
import Product from "@/lib/models/product.model";
import { scrapeAmazonProduct } from "@/lib/scraper";
import { generateEmailBody, sendEmail } from "@/lib/nodemailer";

export const maxDuration = 10; // This function can run for a maximum of 10 seconds
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Function to process a batch of products
async function processProductBatch(products: any[]) {
  const updatedProducts = [];

  for (const currentProduct of products) {
    try {
      // Scrape product
      const scrapedProduct = await scrapeAmazonProduct(currentProduct.url);

      if (!scrapedProduct) continue;

      const updatedPriceHistory = [
        ...currentProduct.priceHistory,
        {
          price: scrapedProduct.currentPrice,
        },
      ];

      const product = {
        ...scrapedProduct,
        priceHistory: updatedPriceHistory,
        lowestPrice: getLowestPrice(updatedPriceHistory),
        highestPrice: getHighestPrice(updatedPriceHistory),
        averagePrice: getAveragePrice(updatedPriceHistory),
      };

      // Update Products in DB
      const updatedProduct = await Product.findOneAndUpdate(
        { url: product.url },
        product
      );

      // Check each product's status and send email accordingly
      const emailNotifType = getEmailNotifType(scrapedProduct, currentProduct);

      if (emailNotifType && updatedProduct.users.length > 0) {
        const productInfo = {
          title: updatedProduct.title,
          url: updatedProduct.url,
        };

        // Construct emailContent
        const emailContent = await generateEmailBody(productInfo, emailNotifType);

        // Get array of user emails
        const userEmails = updatedProduct.users.map((user: any) => user.email);

        // Send email notification
        await sendEmail(emailContent, userEmails);
      }

      updatedProducts.push(updatedProduct);
    } catch (error: any) { // Explicitly define the type of the caught error
      console.error(`Error processing product: ${error.message}`);
    }
  }

  return updatedProducts;
}

export async function GET(request: Request) {
  try {
    connectToDB();

    const products = await Product.find({});

    if (!products || products.length === 0) {
      console.error("No products fetched");
      return NextResponse.json({ message: "No products fetched" });
    }

    const batchSize = 5; // Define an appropriate batch size

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      await processProductBatch(batch);
    }

    return NextResponse.json({
      message: "Ok",
      data: "Processing completed",
    });
  } catch (error: any) {
    throw new Error(`Failed to get all products: ${error.message}`);
  }
}
