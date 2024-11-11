// server.js

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

// Set up Multer storage engine
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Uploads directory
  },
  filename: function (req, file, cb) {
    // Generate a unique filename
    const timestamp = Date.now();
    const uniqueSuffix = timestamp + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'pdfFile-' + uniqueSuffix + ext);
  }
});

// Initialize Multer with storage configuration and file filters
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // Limit file size to 50MB
  fileFilter: function (req, file, cb) {
    checkFileType(file, cb);
  }
});

// Function to check the uploaded file type
function checkFileType(file, cb) {
  // Allowed file extensions
  const filetypes = /pdf/;
  // Check file extension
  const extname = filetypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  // Check MIME type
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb('Error: Only PDF files are allowed!');
  }
}

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded PDFs from the 'uploads' directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Redirect root URL to the landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Store the current page number and PDF filename for synchronization
let currentPage = 1;
let currentPdf = null;

// Function to get list of PDFs in the uploads directory
function getUploadedPdfs() {
  return new Promise((resolve, reject) => {
    fs.readdir('uploads/', (err, files) => {
      if (err) {
        reject(err);
      } else {
        // Filter PDF files
        const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');
        resolve(pdfFiles);
      }
    });
  });
}

// Endpoint to get the list of uploaded PDFs
app.get('/pdf-list', async (req, res) => {
  try {
    const pdfFiles = await getUploadedPdfs();
    res.json({ pdfFiles });
  } catch (err) {
    console.error('Error fetching PDF list:', err);
    res.status(500).json({ error: 'Failed to fetch PDF list' });
  }
});

// Handle file upload via POST request to '/upload'
app.post('/upload', upload.single('pdfFile'), (req, res) => {
  console.log('File uploaded successfully:', req.file.filename);

  // Reset current page to 1 after a new PDF is uploaded
  currentPage = 1;

  // Update current PDF to the newly uploaded file
  currentPdf = req.file.filename;

  // Notify all connected clients about the new PDF
  io.emit('pdf-updated', { pdfFilename: currentPdf });

  res.json({ success: true, filename: req.file.filename });
});

// Socket.io connection handling for real-time communication
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Send the current PDF and page to the new user
  socket.emit('load-pdf', { pdfFilename: currentPdf, pageNum: currentPage });

  // Listen for page change events from the presenter
  socket.on('page-change', (pageNumber) => {
    currentPage = pageNumber; // Update the current page number
    socket.broadcast.emit('update-page', pageNumber); // Notify other clients
  });

  // Listen for PDF selection from presenter
  socket.on('select-pdf', (pdfFilename) => {
    currentPdf = pdfFilename;
    currentPage = 1; // Reset to first page
    // Notify all clients to load the new PDF
    io.emit('pdf-updated', { pdfFilename: currentPdf });
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start the server and listen on the specified port
http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});


app.delete('/clear-files', (req, res) => {
  const uploadsDir = path.join(__dirname, 'uploads');

  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      console.error('Error reading uploads directory:', err);
      return res.status(500).json({ success: false, message: 'Failed to access uploads directory.' });
    }

    if (files.length === 0) {
      return res.json({ success: true, message: 'No files to delete.' });
    }

    const deletePromises = files.map(file => {
      return new Promise((resolve, reject) => {
        fs.unlink(path.join(uploadsDir, file), err => {
          if (err) {
            console.error(`Error deleting file ${file}:`, err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });

    Promise.all(deletePromises)
      .then(() => {
        console.log('All files deleted successfully.');
        res.json({ success: true, message: 'All files cleared successfully.' });
      })
      .catch(err => {
        console.error('Error deleting files:', err);
        res.status(500).json({ success: false, message: 'Failed to delete some files.' });
      });
  });
});
