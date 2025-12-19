import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryMany, execute } from '../utils/database';

const router = Router();

// Note: Images are stored in the properties table as a JSON array in the images column
// This route provides a separate API for managing images

// GET /api/property-images/:propertyId - Get all images for a property
router.get('/:propertyId', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;

    const property = await queryOne<{ images: string }>(
      `SELECT images FROM properties WHERE id = @propertyId`,
      { propertyId }
    );

    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    let images: string[] = [];
    try {
      images = property.images ? JSON.parse(property.images) : [];
    } catch { }

    // Convert to image objects with IDs for compatibility
    const imageObjects = images.map((url: string, index: number) => ({
      id: `img_${index}`,
      property_id: propertyId,
      url,
      order: index
    }));

    res.json(imageObjects);
  } catch (error) {
    console.error('Error fetching property images:', error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// POST /api/property-images/:propertyId - Add images to a property
router.post('/:propertyId', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { image_urls } = req.body;

    if (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0) {
      return res.status(400).json({ error: 'image_urls array is required' });
    }

    const property = await queryOne<{ images: string }>(
      `SELECT images FROM properties WHERE id = @propertyId`,
      { propertyId }
    );

    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    let existingImages: string[] = [];
    try {
      existingImages = property.images ? JSON.parse(property.images) : [];
    } catch { }

    const updatedImages = [...existingImages, ...image_urls];

    await execute(
      `UPDATE properties SET images = @images WHERE id = @propertyId`,
      { propertyId, images: JSON.stringify(updatedImages) }
    );

    res.status(201).json({
      success: true,
      images: updatedImages.map((url: string, index: number) => ({
        id: `img_${index}`,
        property_id: propertyId,
        url,
        order: index
      }))
    });
  } catch (error) {
    console.error('Error adding property images:', error);
    res.status(500).json({ error: 'Failed to add images' });
  }
});

// PUT /api/property-images/:propertyId/reorder - Reorder images
router.put('/:propertyId/reorder', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const { image_order } = req.body; // Array of image URLs in new order

    if (!image_order || !Array.isArray(image_order)) {
      return res.status(400).json({ error: 'image_order array is required' });
    }

    await execute(
      `UPDATE properties SET images = @images WHERE id = @propertyId`,
      { propertyId, images: JSON.stringify(image_order) }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error reordering property images:', error);
    res.status(500).json({ error: 'Failed to reorder images' });
  }
});

// DELETE /api/property-images/:propertyId/:imageIndex - Delete a specific image
router.delete('/:propertyId/:imageIndex', async (req: Request, res: Response) => {
  try {
    const { propertyId, imageIndex } = req.params;
    const index = parseInt(imageIndex, 10);

    const property = await queryOne<{ images: string }>(
      `SELECT images FROM properties WHERE id = @propertyId`,
      { propertyId }
    );

    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    let images: string[] = [];
    try {
      images = property.images ? JSON.parse(property.images) : [];
    } catch { }

    if (index < 0 || index >= images.length) {
      return res.status(404).json({ error: 'Image not found' });
    }

    images.splice(index, 1);

    await execute(
      `UPDATE properties SET images = @images WHERE id = @propertyId`,
      { propertyId, images: JSON.stringify(images) }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting property image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// DELETE /api/property-images/:propertyId - Delete all images for a property
router.delete('/:propertyId', async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;

    await execute(
      `UPDATE properties SET images = '[]' WHERE id = @propertyId`,
      { propertyId }
    );

    res.json({ success: true, message: 'All images deleted' });
  } catch (error) {
    console.error('Error deleting all property images:', error);
    res.status(500).json({ error: 'Failed to delete images' });
  }
});

export default router;
