// public/script.js

const socket = io();

// PDF.js setup
let pdfDoc = null,
    pageNum = 1,
    pageIsRendering = false,
    pageNumPending = null;

// Variable to store the current PDF filename
let currentPdf = null;

const scale = 1.5,
      canvas = document.getElementById('pdf-render'),
      ctx = canvas.getContext('2d');

// Get elements
const uploadSection = document.getElementById('upload-section');
const uploadForm = document.getElementById('upload-form');
const pdfFileInput = document.getElementById('pdf-file');

const pdfSelectionSection = document.getElementById('pdf-selection-section');
const pdfList = document.getElementById('pdf-list');
const refreshPdfListBtn = document.getElementById('refresh-pdf-list');

// Determine if user is admin
const isAdmin = () => {
  return window.isPresenter;
};

// Emit page change to server if user is admin
const emitPageChange = (pageNum) => {
  if (isAdmin()) {
    socket.emit('page-change', pageNum);
  }
};

// Function to show the previous page
const showPrevPage = () => {
  if (pageNum <= 1) {
    return;
  }
  pageNum--;
  queueRenderPage(pageNum);
  emitPageChange(pageNum);
};

// Function to show the next page
const showNextPage = () => {
  if (pageNum >= pdfDoc.numPages) {
    return;
  }
  pageNum++;
  queueRenderPage(pageNum);
  emitPageChange(pageNum);
};

// Function to render the page
const renderPage = (num) => {
  pageIsRendering = true;

  // Get the page
  pdfDoc.getPage(num).then((page) => {
    // Set scale
    const viewport = page.getViewport({ scale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Render PDF page into canvas context
    const renderCtx = {
      canvasContext: ctx,
      viewport,
    };

    page.render(renderCtx).promise.then(() => {
      pageIsRendering = false;

      if (pageNumPending !== null) {
        renderPage(pageNumPending);
        pageNumPending = null;
      }
    });

    // Output current page
    document.getElementById('page-num').textContent = num;
  });
};

// Check for pages rendering
const queueRenderPage = (num) => {
  if (pageIsRendering) {
    pageNumPending = num;
  } else {
    renderPage(num);
  }
};

// Event listeners for navigation buttons
document.getElementById('prev-page').addEventListener('click', showPrevPage);
document.getElementById('next-page').addEventListener('click', showNextPage);

// Initialize interface based on role
if (isAdmin()) {
  // Admin role
  emitPageChange(pageNum);
  document.getElementById('controls').style.display = 'flex';
  uploadSection.style.display = 'block';
  pdfSelectionSection.style.display = 'block';
  // Load the list of PDFs
  loadPdfList();
} else {
  // Viewer role
  document.getElementById('controls').style.display = 'none';
  uploadSection.style.display = 'none';
  pdfSelectionSection.style.display = 'none';
  // Optionally hide the sidebar for viewers
  document.getElementById('sidebar').style.display = 'none';
}

// Function to fetch and display the list of PDFs
function loadPdfList() {
  fetch('/pdf-list')
    .then(response => response.json())
    .then(data => {
      pdfList.innerHTML = '';
      data.pdfFiles.forEach(filename => {
        const listItem = document.createElement('li');
        listItem.textContent = filename;
        listItem.style.cursor = 'pointer';
        listItem.addEventListener('click', () => {
          selectPdf(filename);
        });
        pdfList.appendChild(listItem);
      });
    })
    .catch(error => {
      console.error('Error fetching PDF list:', error);
      alert('Error fetching PDF list.');
    });
}
// public/script.js


// Function to select a PDF
function selectPdf(filename) {
  if (isAdmin()) {
    // Emit event to server to update current PDF
    socket.emit('select-pdf', filename);

    // Load the selected PDF
    currentPdf = filename;
    pageNum = 1; // Reset to first page
    loadPdf();
  }
}

// Event listener for refresh button
refreshPdfListBtn.addEventListener('click', loadPdfList);

// Handle PDF upload
if (isAdmin() && uploadForm) {
  uploadForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const file = pdfFileInput.files[0];

    if (file && file.type === 'application/pdf') {
      const formData = new FormData();
      formData.append('pdfFile', file);

      fetch('/upload', {
        method: 'POST',
        body: formData
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            alert('PDF uploaded successfully.');
            // Update the list of PDFs
            loadPdfList();
            // Select the newly uploaded PDF
            selectPdf(data.filename);
          } else {
            alert('Failed to upload PDF.');
          }
        })
        .catch((error) => {
          console.error('Error:', error);
          alert('Error uploading PDF.');
        });
    } else {
      alert('Please select a PDF file.');
    }
  });
}

// Function to load the PDF
function loadPdf() {
  if (!currentPdf) {
    console.warn('No PDF selected.');
    if (isAdmin()) {
      alert('Please select a PDF to start the presentation.');
    } else {
      alert('No presentation is currently available. Please wait for the presenter.');
    }
    // Hide canvas and controls
    document.getElementById('pdf-render').style.display = 'none';
    document.getElementById('controls').style.display = 'none';
    return;
  }

  const pdfUrl = '/uploads/' + currentPdf;

  // Check if the PDF file exists before attempting to load
  fetch(pdfUrl, { method: 'HEAD' })
    .then((response) => {
      if (response.ok) {
        // PDF exists, proceed to load it
        pdfjsLib.getDocument(pdfUrl).promise.then((pdfDoc_) => {
          pdfDoc = pdfDoc_;
          document.getElementById('page-count').textContent = pdfDoc.numPages;
          // Use the current page number
          renderPage(pageNum);
          document.getElementById('pdf-render').style.display = 'block';
          if (isAdmin()) {
            document.getElementById('controls').style.display = 'flex';
          }
        }).catch((err) => {
          console.error('Error loading PDF:', err);
          alert('Error loading PDF.');
        });
      } else {
        // PDF does not exist, handle accordingly
        console.warn('PDF not found.');
        if (isAdmin()) {
          alert('No PDF uploaded yet. Please upload a PDF to start the presentation.');
        } else {
          alert('No presentation is currently available. Please wait for the presenter to upload a PDF.');
        }
        // Hide canvas and controls
        document.getElementById('pdf-render').style.display = 'none';
        document.getElementById('controls').style.display = 'none';
      }
    })
    .catch((err) => {
      console.error('Error checking PDF existence:', err);
      alert('Error checking for PDF. Please try again later.');
    });
}

// Listen for 'load-pdf' event from server
socket.on('load-pdf', (data) => {
  currentPdf = data.pdfFilename;
  pageNum = data.pageNum || 1;
  loadPdf();
});

// Listen for 'pdf-updated' event from server
socket.on('pdf-updated', (data) => {
  if (!isAdmin()) {
    currentPdf = data.pdfFilename;
    pageNum = 1;
    loadPdf();
  }
});

// Listen for page updates from the server
socket.on('update-page', (num) => {
  if (!isAdmin()) {
    pageNum = num;
    queueRenderPage(num);
  }
});
document.getElementById('help-btn').addEventListener('click', () => {
    alert('Need help? Contact support@example.com.');
  });
  
  document.getElementById('logout-btn').addEventListener('click', () => {
    // Redirect to the landing page
    window.location.href = '/';
  });
// Initial PDF load
loadPdf();


